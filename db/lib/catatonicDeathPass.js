// The Catatonic death pass — TURN-ENGINE.md §2 pass 7b, and THE deliberate
// exception to the engine's oldest rule. Everywhere else a terminal chain
// stops at `dying` and a GM confirms the death by hand; here, a character
// who has held `catatonic` for GameConfig.catatonicDeathTurns consecutive
// turns dies at the close, no hand on the lever. The countdown clock is
// Character.catatonicSinceTurn, stamped by whichever granted the tag
// (db/lib/catatonicPass.js for AFK, db/lib/playerDeparture.js for a guild
// leave) and nulled the moment the tag clears — so any act of waking resets
// the clock entirely, and a GM hand-grant with no stamp never counts down at
// all.
//
// A separate module and a separate TURN_PASSES entry rather than a branch of
// the flagging pass, for three reasons: it must run strictly AFTER the clear
// branch, so a character who woke this very turn can never be killed by the
// same close; a destructive pass deserves its own resolvedPasses marker, so
// a resumed turn can't half-kill; and keeping the flagger a flagger means
// the invariant-breaking code is one small file a reviewer reads in full.
//
// Same discipline as every pass: DB writes only, one summary audit row
// (written by db/index.js), Discord work — access revoke, role delete,
// conditional Cursed grant, DMs, the #leave alert — returned as `deaths` and
// `warnings` for the side-effect thunk. GameConfig.catatonicDeathTurns = 0
// is the GM's off switch, no deploy needed.
//
// Takes `prisma` as a parameter — see db/lib/dm.js for why.
const { CATATONIC_SLUG } = require("./constants");
const { applyDeathToRow } = require("./characterDeath");

function deathWarningDm() {
  return (
    `You have been Catatonic for a long time. Unless you act or speak in character ` +
    `before the turn ends, your character will die.`
  );
}

async function runCatatonicDeathPass(prisma, turn) {
  const config = await prisma.gameConfig.findUnique({ where: { id: 1 } });

  // Off (0) is a real, supported state — return an object, not null. null
  // means "did not run, retry it forever" and would wedge the turn. Not
  // additionally gated on catatonicEnabled: that switch governs AFK
  // *flagging*, and a leaver's tag comes from playerDeparture.js regardless
  // — their countdown should still resolve.
  const deathTurns = Math.max(0, config?.catatonicDeathTurns ?? 0);
  if (deathTurns === 0) {
    return { turnNumber: turn.number, enabled: false, killed: 0, names: [], deaths: [], warnings: [] };
  }

  const catatonicTag = await prisma.tag.findUnique({
    where: { slug: CATATONIC_SLUG },
    select: { id: true },
  });
  if (!catatonicTag) {
    console.error(`Catatonic death pass skipped: no "${CATATONIC_SLUG}" tag — run npm run db:sync-tags.`);
    return null;
  }

  // Flagged at the close of turn T means catatonic through T+1 … T+deathTurns;
  // the death lands at the close of T+deathTurns. The tag check rides along
  // so a GM who hand-removed the tag but left a stale stamp (or the reverse)
  // fails safe: both must agree before anyone dies.
  const doomed = await prisma.character.findMany({
    where: {
      status: "ALIVE",
      catatonicSinceTurn: { not: null, lte: turn.number - deathTurns },
      tags: { some: { tagId: catatonicTag.id } },
    },
    select: {
      id: true,
      name: true,
      discordUserId: true,
      discordRoleId: true,
      zoneId: true,
      leftGuildAt: true,
    },
  });

  const deaths = [];
  for (const character of doomed) {
    const reason =
      character.leftGuildAt != null
        ? "the player left the guild and never returned."
        : "they never woke from their catatonia.";
    // The conditional claim inside applyDeathToRow (status must still be
    // ALIVE) is what makes a resumed turn unable to kill twice.
    const { claimed } = await applyDeathToRow(prisma, character, {
      turn,
      content: `${character.name} died — ${reason}`,
    });
    if (!claimed) continue;
    deaths.push({
      characterId: character.id,
      name: character.name,
      discordUserId: character.discordUserId,
      // Captured before applyDeathToRow nulled the column — the thunk still
      // owes Discord this role's deletion.
      discordRoleId: character.discordRoleId,
      zoneId: character.zoneId,
      leftGuild: character.leftGuildAt != null,
      reason,
    });
  }

  // The eve-of warning, same posture as the Nobility track's: one DM the
  // close before the axe, nothing on the quiet turns in between. Departed
  // players are skipped — the account is gone and the send would only 403.
  const warned = await prisma.character.findMany({
    where: {
      status: "ALIVE",
      leftGuildAt: null,
      catatonicSinceTurn: turn.number - deathTurns + 1,
      tags: { some: { tagId: catatonicTag.id } },
    },
    select: { discordUserId: true },
  });

  return {
    turnNumber: turn.number,
    enabled: true,
    killed: deaths.length,
    names: deaths.map((death) => death.name),
    deaths,
    warnings: warned.map((character) => ({
      discordUserId: character.discordUserId,
      content: deathWarningDm(),
    })),
  };
}

module.exports = { runCatatonicDeathPass };
