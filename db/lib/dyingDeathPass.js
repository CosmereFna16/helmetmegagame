// The Dying death pass — the second of the engine's two auto-kills, and the
// one that retired the oldest rule in the turn engine.
//
// Every terminal chain in the catalog lands on `dying` (tagExpiryPass.js) and
// so does the hunger streak cap (hungerPass.js). Dying used to be permanent
// and a GM decided how it ended, which meant a character could sit on death's
// door for a week because nobody got round to the Kill button. Now it carries
// a one-turn clock like any other timed tag, and this pass is what the clock
// runs down to.
//
// THE CLOCK IS `CharacterTag.expiresTurn`, the same column every other timed
// tag uses, stamped from the catalog's `durationTurns: 1` by whichever path
// granted it. Two consequences worth stating out loud:
//
//   - This pass must run BEFORE resolveNeeds()'s blind expiry sweep. The
//     sweep deletes exactly the rows whose clock is due, so after it there is
//     nothing left to read and nobody dies.
//   - A row with a NULL clock is not killed. It is stamped for the NEXT close
//     and its holder warned. That covers the grants that predate this pass and
//     any GM hand-grant made before the game had a duration to copy — nobody
//     is killed by a clock they were never shown.
//
// Slotted after stagedPush and tagExpiry deliberately: a GM's staged "remove
// Dying" and a medic's cure both land earlier in the same close, so a
// treatment that arrived in time always beats the axe.
//
// Same discipline as every pass: DB writes only, one summary audit row
// (written by db/index.js), Discord work — access revoke, role delete,
// Cursed grant, DMs, the #leave alert — returned as `deaths` and `warnings`
// for the side-effect thunk.
//
// Takes `prisma` as a parameter — see db/lib/dm.js for why.
const { DYING_SLUG } = require("./constants");
const { applyDeathToRow } = require("./characterDeath");

const DEATH_REASON = "they never came back from Dying.";

function deathWarningDm() {
  return (
    `You are **Dying**. Unless someone with real medicine reaches you before ` +
    `the turn ends, that is how this ends.`
  );
}

async function runDyingDeathPass(prisma, turn) {
  const dyingTag = await prisma.tag.findUnique({ where: { slug: DYING_SLUG }, select: { id: true } });
  if (!dyingTag) {
    console.error(`Dying death pass skipped: no "${DYING_SLUG}" tag — run npm run db:sync-tags.`);
    return null;
  }

  // Clockless rows first, and note the order: stamping happens BEFORE the
  // doomed read, but the stamp is turn.number + 1, so nothing stamped here
  // can match the `lte: turn.number` predicate below. A character who picks
  // up an unclocked Dying gets their full turn.
  const clockless = await prisma.characterTag.findMany({
    where: { tagId: dyingTag.id, expiresTurn: null, character: { status: "ALIVE" } },
    select: { id: true, character: { select: { discordUserId: true } } },
  });
  if (clockless.length > 0) {
    await prisma.characterTag.updateMany({
      where: { id: { in: clockless.map((ct) => ct.id) } },
      data: { expiresTurn: turn.number + 1 },
    });
  }

  const doomed = await prisma.character.findMany({
    where: {
      status: "ALIVE",
      tags: { some: { tagId: dyingTag.id, expiresTurn: { not: null, lte: turn.number } } },
    },
    select: { id: true, name: true, discordUserId: true, discordRoleId: true, zoneId: true },
  });

  const deaths = [];
  for (const character of doomed) {
    // The conditional claim inside applyDeathToRow (status must still be
    // ALIVE) is what makes a resumed turn unable to kill twice.
    const { claimed } = await applyDeathToRow(prisma, character, {
      turn,
      content: `${character.name} died — ${DEATH_REASON}`,
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
      reason: DEATH_REASON,
    });
  }

  // The eve-of warning, same posture as the Catatonic track's: everyone whose
  // clock comes due at the NEXT close hears about it once. That is both the
  // rows just stamped and anyone granted Dying earlier in this same close.
  const warned = await prisma.character.findMany({
    where: {
      status: "ALIVE",
      leftGuildAt: null,
      tags: { some: { tagId: dyingTag.id, expiresTurn: turn.number + 1 } },
    },
    select: { discordUserId: true },
  });

  return {
    turnNumber: turn.number,
    killed: deaths.length,
    names: deaths.map((death) => death.name),
    stamped: clockless.length,
    deaths,
    warnings: warned.map((character) => ({
      discordUserId: character.discordUserId,
      content: deathWarningDm(),
    })),
  };
}

module.exports = { runDyingDeathPass };
