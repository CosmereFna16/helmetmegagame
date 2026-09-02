// The Dying death pass — the second of the engine's two auto-kills. Every
// terminal chain in the catalog lands on `dying` (tagExpiryPass.js); this
// pass runs down `CharacterTag.expiresTurn` on that tag and kills whoever
// it's reached. It MUST run before resolveNeeds()'s blind expiry sweep,
// which deletes exactly the rows whose clock is due — after it there is
// nothing left to read. A NULL clock is stamped for the next close and its
// holder warned, never killed outright. Slotted after stagedPush and
// tagExpiry so a same-close cure or staged removal beats the axe. Discord
// work is returned as `deaths`/`warnings` for the side-effect thunk.
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
