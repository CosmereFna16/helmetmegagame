// The Discord half of ANY location change — the Travel button, the web's
// writers (creation, GM teleport, Bulk Move, MOVE_CHARACTER) and the staged
// "Relocate to" at the turn push all call this after their DB write has
// committed, never from inside it (see db/lib/stagedPush.js on why nothing
// there touches Discord). Pure REST, so one implementation serves both
// faces. Deliberately NOT on the @lifeweb/db barrel, same reasoning as
// db/lib/dm.js — require it by path.
//
// Every call here is .catch-logged, never thrown; the channel doctor's
// post-turn pass (config.autoReconcileEnabled) is the safety net for
// anything a call here missed.
const {
  addMemberRole,
  removeMemberRole,
  putChannelOverwrite,
  deleteChannelOverwrite,
  postMessage,
} = require("./discordRest");
const { buildNarrowcastContext, computeNarrowcastAccess, SPECIAL_CHANNELS } = require("./specialChannels");
const { applyPendingInvites } = require("./threadInvites");
const { syncCharacterRoomAccess } = require("./roomAccess");
const { settleCarry, deliverCarryDrop } = require("./carry");
const { reconcileCorpses } = require("./corpseFollow");
const { LOCATION_MEMBER_ALLOW } = require("./zoneChannelSpec");
const { linkBetween } = require("./locationGraph");
const { aliasSubject } = require("./concealedIdentity");

// Mirrors web/lib/discordGuild.js's PERM_VIEW_CHANNEL / PERM_SEND_MESSAGES —
// duplicated rather than imported because db/ cannot reach into web/.
const PERM_VIEW_CHANNEL = 1024;
const PERM_SEND_MESSAGES = 2048;

// Reconciles a character's per-member overwrites on the narrowcast channels
// (#watch, #intercom) against their CURRENT zone/tags. Same
// computation as web/lib/discordGuild.js#syncCharacterNarrowcastAccess,
// built on the db/lib REST primitives instead of the web ones.
async function reconcileNarrowcastAccess(prisma, characterId, discordUserId) {
  const [ctx, config] = await Promise.all([
    buildNarrowcastContext(prisma, characterId),
    prisma.gameConfig.findUnique({ where: { id: 1 } }),
  ]);
  const access = computeNarrowcastAccess(ctx);

  await Promise.all(
    SPECIAL_CHANNELS.map((entry) => [entry.slug, config?.[entry.configKey]])
      .filter(([, channelId]) => channelId)
      .map(async ([slug, channelId]) => {
        const grant = access[slug];
        try {
          if (grant) {
            let allow = 0;
            if (grant.view || grant.send) allow |= PERM_VIEW_CHANNEL;
            if (grant.send) allow |= PERM_SEND_MESSAGES;
            await putChannelOverwrite(channelId, discordUserId, { allow: String(allow), type: 1 });
          } else {
            await deleteChannelOverwrite(channelId, discordUserId);
          }
        } catch (err) {
          console.error(`Narrowcast sync failed for ${slug}/${characterId}:`, err.message ?? err);
        }
      }),
  );
}

// Grant BEFORE revoke, deliberately: an interrupted swap leaves the player
// seeing two rooms for a moment (harmless, self-healing) rather than none
// (a lockout a player can't diagnose).
async function swapRole(discordUserId, fromRoleId, toRoleId, label) {
  if (toRoleId) {
    await addMemberRole(discordUserId, toRoleId).catch((err) =>
      console.error(`Move: failed to grant ${discordUserId} the ${label} role ${toRoleId}:`, err.message ?? err),
    );
  }
  if (fromRoleId && fromRoleId !== toRoleId) {
    await removeMemberRole(discordUserId, fromRoleId).catch((err) =>
      console.error(`Move: failed to remove ${discordUserId}'s ${label} role ${fromRoleId}:`, err.message ?? err),
    );
  }
}

// The Location half of a move, and the reason a Location wears no Discord
// role: one per-member overwrite on the destination channel, one taken off
// the origin. Same grant-before-revoke ordering and the same two REST calls
// the role swap cost, but it spends none of the guild's 250 roles — see the
// header of db/lib/zoneChannelSpec.js.
async function swapLocationOverwrite(discordUserId, fromChannelId, toChannelId) {
  if (toChannelId) {
    await putChannelOverwrite(toChannelId, discordUserId, {
      allow: String(LOCATION_MEMBER_ALLOW),
      type: 1,
    }).catch((err) =>
      console.error(`Move: failed to open ${toChannelId} to ${discordUserId}:`, err.message ?? err),
    );
  }
  if (fromChannelId && fromChannelId !== toChannelId) {
    await deleteChannelOverwrite(fromChannelId, discordUserId).catch((err) =>
      console.error(`Move: failed to close ${fromChannelId} to ${discordUserId}:`, err.message ?? err),
    );
  }
}

// A gate crossing, announced in the destination zone's #summary. This is
// game narration rather than the character speaking, so it is a plain bot
// message and NOT postAsCharacter — a webhook post under the traveller's own
// name and face would defeat the whole point of the unmanned form.
//
// The two forms differ only in who the line names. A manned gate has a
// watchman on it, so it reads the traveller's papers: their true name, and
// /conceal does not help. An unmanned one has nobody to read anything, so it
// records what a passer-by would have seen — "An old woman" — and never the
// name behind it.
//
// Derived from the edge rather than passed in, so every writer of
// Character.locationId gets this for free. A GM's teleport onto a
// non-adjacent location finds no link and announces nothing, which is right.
async function announceGateCrossing(prisma, character, fromLocationId, toLocation) {
  if (!fromLocationId) return;
  const channelId = toLocation.zone?.discordSummaryChannelId ?? null;
  if (!channelId) return;

  const link = await linkBetween(prisma, fromLocationId, toLocation.id);
  if (!link || link.announce === "NONE") return;

  const who = link.announce === "TRUE_NAME" ? character.name : aliasSubject(character);
  if (!who) return;
  await postMessage(channelId, `» ${who} has entered ${toLocation.name}. ‡`);
}

// Everything a location change must do in Discord once the DB write has
// landed: swap the location overwrite; announce a gate crossing; if the zone
// changed too, swap the zone
// role and reconcile narrowcast access; then private-room membership for
// wherever they now stand, and any standing conversation invites there.
// `entry` is { characterId, fromLocationId, toLocationId } — zones are read
// from the locations, and the character's row is re-read so a stale caller
// can't swap the wrong account.
async function applyLocationMoveSideEffects(prisma, { characterId, fromLocationId, toLocationId }) {
  if (!characterId || !toLocationId) return;
  if (fromLocationId === toLocationId) return;
  if (!process.env.DISCORD_TOKEN) return;

  const [fromLocation, toLocation, character] = await Promise.all([
    fromLocationId ? prisma.location.findUnique({ where: { id: fromLocationId }, include: { zone: true } }) : null,
    prisma.location.findUnique({ where: { id: toLocationId }, include: { zone: true } }),
    prisma.character.findUnique({
      where: { id: characterId },
      select: {
        id: true,
        name: true,
        discordUserId: true,
        locationId: true,
        status: true,
        concealed: true,
        age: true,
        gender: true,
      },
    }),
  ]);
  if (!character?.discordUserId || !toLocation) return;
  const discordUserId = character.discordUserId;

  await swapLocationOverwrite(
    discordUserId,
    fromLocation?.discordChannelId ?? null,
    toLocation.discordChannelId ?? null,
  );

  await announceGateCrossing(prisma, character, fromLocationId, toLocation).catch((err) =>
    console.error(`Move: gate announcement failed for ${characterId}:`, err.message ?? err),
  );

  if (fromLocation?.zoneId !== toLocation.zoneId) {
    await swapRole(discordUserId, fromLocation?.zone?.discordRoleId ?? null, toLocation.zone?.discordRoleId ?? null, "zone");
    await reconcileNarrowcastAccess(prisma, characterId, discordUserId).catch((err) =>
      console.error(`Move: narrowcast reconcile failed for ${characterId}:`, err.message ?? err),
    );
  }

  // Settle carry BEFORE room access: arriving somewhere with a public room
  // is what lets a deferred overflow drop finally land (db/lib/carry.js),
  // and that drop can take a private-room key off the sheet, so membership
  // has to be recomputed from the post-drop holdings.
  const carry = await settleCarry(prisma, characterId).catch((err) => {
    console.error(`Move: carry settle failed for ${characterId}:`, err.message ?? err);
    return null;
  });

  await syncCharacterRoomAccess(prisma, { ...character, locationId: toLocationId }).catch((err) =>
    console.error(`Move: room access sync failed for ${characterId}:`, err.message ?? err),
  );

  // Any body this character was carrying has just moved with them, and NOTHING
  // WROTE A TAG to say so — only their own locationId changed. This is the one
  // hook the whole corpse-as-handle design depends on; a push from a tag writer
  // could never catch it. See db/lib/corpseFollow.js.
  await reconcileCorpses(prisma).catch((err) =>
    console.error(`Move: corpse follow failed for ${characterId}:`, err.message ?? err),
  );
  if (carry?.drop) {
    await deliverCarryDrop(prisma, carry).catch((err) =>
      console.error(`Move: carry drop delivery failed for ${characterId}:`, err.message ?? err),
    );
  }
  await applyPendingInvites(prisma, { ...character, locationId: toLocationId }).catch((err) =>
    console.error(`Move: thread invite pass failed for ${characterId}:`, err.message ?? err),
  );
}

module.exports = { applyLocationMoveSideEffects, reconcileNarrowcastAccess };
