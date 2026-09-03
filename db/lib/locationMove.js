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
const { addMemberRole, removeMemberRole, putChannelOverwrite, deleteChannelOverwrite } = require("./discordRest");
const { buildNarrowcastContext, computeNarrowcastAccess, SPECIAL_CHANNELS } = require("./specialChannels");
const { applyPendingInvites } = require("./threadInvites");
const { syncCharacterRoomAccess } = require("./roomAccess");

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

// Everything a location change must do in Discord once the DB write has
// landed: swap the location role; if the zone changed too, swap the zone
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
      select: { id: true, discordUserId: true, locationId: true, status: true },
    }),
  ]);
  if (!character?.discordUserId || !toLocation) return;
  const discordUserId = character.discordUserId;

  await swapRole(discordUserId, fromLocation?.discordRoleId ?? null, toLocation.discordRoleId ?? null, "location");

  if (fromLocation?.zoneId !== toLocation.zoneId) {
    await swapRole(discordUserId, fromLocation?.zone?.discordRoleId ?? null, toLocation.zone?.discordRoleId ?? null, "zone");
    await reconcileNarrowcastAccess(prisma, characterId, discordUserId).catch((err) =>
      console.error(`Move: narrowcast reconcile failed for ${characterId}:`, err.message ?? err),
    );
  }

  await syncCharacterRoomAccess(prisma, { ...character, locationId: toLocationId }).catch((err) =>
    console.error(`Move: room access sync failed for ${characterId}:`, err.message ?? err),
  );
  await applyPendingInvites(prisma, { ...character, locationId: toLocationId }).catch((err) =>
    console.error(`Move: thread invite pass failed for ${characterId}:`, err.message ?? err),
  );
}

module.exports = { applyLocationMoveSideEffects, reconcileNarrowcastAccess };
