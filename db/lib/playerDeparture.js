// The one code path for "a player has left the guild" — shared by the live
// guildMemberRemove handler and the startup reconcile
// (bot/src/lib/leaveReconcile.js), so a leave the bot slept through gets
// exactly the treatment a witnessed one does.
//
// Leaving no longer kills the character. It flags them `catatonic` on the
// spot and starts the death countdown (GameConfig.catatonicDeathTurns turns,
// resolved by db/lib/catatonicDeathPass.js at turn close). If the player
// rejoins and speaks in character before it runs out, the ordinary catatonic
// clear branch wakes them (db/lib/catatonicPass.js).
//
// Pure database — no network. The caller gets back the alert line for #leave
// and the grey role rename, and applies both itself (the bot via gateway, a
// future REST caller via discordRest). Takes `prisma` as the first parameter
// (the db/lib/dm.js convention) and is deliberately NOT on the barrel;
// require it by path.
const { CATATONIC_SLUG } = require("./constants");
const { formatBareName } = require("./characterName");
const { characterRoleAppearance } = require("./characterRoleAppearance");

async function markPlayerDeparted(prisma, { discordUserId, username, viaReconcile = false }) {
  const character = await prisma.character.findFirst({
    where: { discordUserId, status: "ALIVE" },
    include: { role: true },
  });

  // Caught like everything here: a logging hiccup must never strand the
  // departure marking below, which is what the death countdown hangs off.
  await prisma.auditLog
    .create({
      data: {
        actorDiscordUserId: discordUserId,
        actionType: "member_left",
        details: {
          username: username ?? discordUserId,
          characterName: character?.name ?? null,
          viaReconcile,
        },
      },
    })
    .catch((err) => console.error(`Failed to log member_left for ${discordUserId}:`, err));

  const playerName = username ?? discordUserId;
  if (!character) {
    return { character: null, alert: `${playerName} has left. They had no living character.`, roleUpdate: null };
  }

  // Not gated on GameConfig.catatonicEnabled: that switch governs the AFK
  // flagging pass, but a departed player is a fact, not a staleness
  // heuristic. Only the death itself has a dial (catatonicDeathTurns).
  const catatonicTag = await prisma.tag.findUnique({
    where: { slug: CATATONIC_SLUG },
    select: { id: true },
  });
  if (!catatonicTag) {
    console.error(`Departure: no "${CATATONIC_SLUG}" tag — run npm run db:sync-tags. Marking leftGuildAt only.`);
  }

  // The countdown clock. Between closes there is no OPEN turn; fall back to
  // the latest turn, which reads as "flagged at that close" — a leaver in
  // the gap starts at most one turn ahead of one a minute later, immaterial
  // against a multi-turn countdown, so don't read the fallback as a bug.
  const turn =
    (await prisma.turn.findFirst({ where: { status: "OPEN" }, select: { number: true } })) ??
    (await prisma.turn.findFirst({ orderBy: { number: "desc" }, select: { number: true } }));

  await prisma.$transaction([
    ...(catatonicTag
      ? [
          prisma.characterTag.createMany({
            // No expiresTurn, same as the AFK grant: the catatonic pass owns
            // both grant and clear, so nothing sweeps this tag.
            data: [{ characterId: character.id, tagId: catatonicTag.id, source: "EVENT", expiresTurn: null }],
            // They may already hold it from going AFK before leaving.
            skipDuplicates: true,
          }),
        ]
      : []),
    prisma.character.update({
      where: { id: character.id },
      data: { leftGuildAt: new Date() },
    }),
    // Conditional, separate from the update above: a player who was already
    // Catatonic before rage-quitting keeps the countdown they were on rather
    // than getting a fresh one.
    prisma.character.updateMany({
      where: { id: character.id, catatonicSinceTurn: null },
      data: { catatonicSinceTurn: turn?.number ?? 0 },
    }),
  ]);

  const roleLabel = character.roleTitle ?? character.role?.name ?? "Unaffiliated";
  const bare = formatBareName(character);
  const roleUpdate =
    character.discordRoleId && bare
      ? { roleId: character.discordRoleId, ...characterRoleAppearance(bare, { catatonic: true }) }
      : null;

  return {
    character,
    alert: `${playerName} has left. Their character was ${character.name}, a ${roleLabel} — now Catatonic.`,
    roleUpdate,
  };
}

module.exports = { markPlayerDeparted };
