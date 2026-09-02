// Discord side effects for a staged force-move (the desk's "Relocate to" —
// see docs/systemdocs/ADJUDICATION.md). Called AFTER the push transaction
// has already committed Character.zoneId, never from inside it — see
// db/lib/stagedPush.js's comment on why nothing here touches Discord.
// Deliberately NOT on the @lifeweb/db barrel, same reasoning as db/lib/dm.js
// — require it by path: require("@lifeweb/db/lib/zoneMove").
// Every REST call here is .catch-logged, never thrown; the channel doctor's
// post-turn pass (config.autoReconcileEnabled) is the safety net for
// anything a call here missed.
const { addMemberRole, removeMemberRole, putChannelOverwrite, deleteChannelOverwrite } = require("./discordRest");
const { buildNarrowcastContext, computeNarrowcastAccess, SPECIAL_CHANNELS } = require("./specialChannels");
const { applyPendingInvites } = require("./threadInvites");

// Mirrors web/lib/discordGuild.js's PERM_VIEW_CHANNEL / PERM_SEND_MESSAGES —
// duplicated rather than imported because db/ cannot reach into web/.
const PERM_VIEW_CHANNEL = 1024;
const PERM_SEND_MESSAGES = 2048;

// Reconciles a character's per-member overwrites on the narrowcast channels
// (#watch, #intercom) against their CURRENT zone/tags. Same computation as
// web/lib/discordGuild.js#syncCharacterNarrowcastAccess, built on the db/lib
// REST primitives instead of the web ones since db/ can't import web/.
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

// Everything a staged relocation must do in Discord once the DB write has
// landed: swap the zone role (grant before revoke, so an interrupted swap
// leaves the player seeing two zones rather than none), reconcile the two
// narrowcast channels against the new zone, then apply any standing private-
// thread invites for wherever they just arrived.
async function applyZoneMoveSideEffects(prisma, { characterId, fromZoneId, toZoneId }) {
  if (!characterId || !toZoneId) return;
  // Same guards as syncCharacterZoneRole: a no-move move (mass-relocating a
  // party that's partly already there) would burn four idempotent REST calls
  // per character inside the push window, and a tokenless run would only log
  // noise four times per move.
  if (fromZoneId === toZoneId) return;
  if (!process.env.DISCORD_TOKEN) return;

  const [fromZone, toZone] = await Promise.all([
    fromZoneId ? prisma.zone.findUnique({ where: { id: fromZoneId } }) : null,
    prisma.zone.findUnique({ where: { id: toZoneId } }),
  ]);

  const character = await prisma.character.findUnique({
    where: { id: characterId },
    select: { id: true, discordUserId: true, zoneId: true },
  });
  if (!character?.discordUserId) return;
  const discordUserId = character.discordUserId;

  if (toZone?.discordRoleId) {
    await addMemberRole(discordUserId, toZone.discordRoleId).catch((err) =>
      console.error(`Staged move: failed to grant ${discordUserId} the ${toZone.name} zone role:`, err.message ?? err),
    );
  }
  if (fromZone?.discordRoleId && fromZone.discordRoleId !== toZone?.discordRoleId) {
    await removeMemberRole(discordUserId, fromZone.discordRoleId).catch((err) =>
      console.error(`Staged move: failed to remove ${discordUserId}'s ${fromZone.name} zone role:`, err.message ?? err),
    );
  }

  await reconcileNarrowcastAccess(prisma, characterId, discordUserId).catch((err) =>
    console.error(`Staged move: narrowcast reconcile failed for ${characterId}:`, err.message ?? err),
  );

  await applyPendingInvites(prisma, character).catch((err) =>
    console.error(`Staged move: thread invite pass failed for ${characterId}:`, err.message ?? err),
  );
}

module.exports = { applyZoneMoveSideEffects };
