// Catatonic (AFK) upkeep, run from db/index.js#resolveNeeds() so the bot's
// cron advance and the Dev Panel's "End turn" button behave identically —
// same shape and reasoning as db/lib/hungerPass.js.
//
// Any ALIVE character whose Character.lastActivityTurn is more than
// GameConfig.catatonicTurns turns behind the turn being closed gets the
// `catatonic` tag; any Catatonic character whose activity clock has moved
// gets it removed. There is no durationTurns and no expiresTurn on the grant
// — see the comment on the createMany below for why that's the deliberate
// exception, not the Paralyzed bug TAGS.md §5 warns about.
//
// Nothing here kills or hides anyone. It flags a sheet for a GM to notice
// (TAGS.md §5c — nothing automatic ends a character), and it never touches
// the player's own Remove Tag menu, since the tag catalog entry ships
// removable: false.
//
// Shaped for 100+ players: one read, one bulk write pair, no network call —
// the per-player DM is returned as a list for advanceTurn() to send later.
//
// Takes `prisma` as a parameter — see db/lib/dm.js for why.
const { CATATONIC_SLUG } = require("./constants");

function catatonicDm(turns) {
  return (
    `You've been quiet for ${turns} turns. You've gone Catatonic — it lifts the moment ` +
    `you act or speak in character again.`
  );
}

async function runCatatonicPass(prisma, turn) {
  const config = await prisma.gameConfig.findUnique({ where: { id: 1 } });

  // Off is a real, supported state — return an object, not null. null means
  // "did not run, retry it forever," and would wedge the turn permanently on
  // a game that has this switched off on purpose.
  if (!config?.catatonicEnabled) {
    return { turnNumber: turn.number, enabled: false, flagged: 0, cleared: 0, dms: [] };
  }

  const catatonicTag = await prisma.tag.findUnique({
    where: { slug: CATATONIC_SLUG },
    select: { id: true },
  });
  if (!catatonicTag) {
    // Catalog not synced — refuse to half-run rather than silently flag or
    // clear nobody.
    console.error(`Catatonic pass skipped: no "${CATATONIC_SLUG}" tag — run npm run db:sync-tags.`);
    return null;
  }

  const turns = Math.max(1, config.catatonicTurns ?? 4);
  const threshold = turn.number - turns;

  const characters = await prisma.character.findMany({
    where: { status: "ALIVE" },
    select: {
      id: true,
      discordUserId: true,
      lastActivityTurn: true,
      // Only the one gating tag comes back, not the whole tag set — the same
      // shape hungerPass.js uses to stay flat at 100+ characters.
      tags: { where: { tagId: catatonicTag.id }, select: { tagId: true } },
    },
  });

  const toFlag = [];
  const toClear = [];

  for (const character of characters) {
    // A character with no clock yet (pre-migration, or created this instant)
    // is read as "active right now" — never as stale — so nobody is flagged
    // off a null the moment this ships.
    const lastActivityTurn = character.lastActivityTurn ?? turn.number;
    const stale = lastActivityTurn <= threshold;
    const held = character.tags.length > 0;

    if (stale && !held) toFlag.push(character);
    else if (!stale && held) toClear.push(character.id);
  }

  // One transaction so a character can never be left flagged-and-cleared out
  // of step with itself.
  const [flagged] = await prisma.$transaction([
    prisma.characterTag.createMany({
      // expiresTurn: null, unlike Hunger — this pass owns both the grant AND
      // the clear (the toClear branch above), so there is no sweep to hand it
      // to. Stamping a turn-count expiry here would let the expiry sweep
      // silently drop it while the character is still stale, and then this
      // pass's own skipDuplicates re-grant on the following turn would land
      // fine — but the player would see the tag flicker off for a turn with
      // nothing having changed. Permanent-until-explicitly-cleared is correct.
      data: toFlag.map((character) => ({
        characterId: character.id,
        tagId: catatonicTag.id,
        source: "EVENT",
        expiresTurn: null,
      })),
      // A character can already hold it from a previous stale turn if this
      // pass's clear branch somehow missed them (e.g. a crash mid-transaction
      // on a prior turn) — keep the re-grant a no-op rather than a unique
      // constraint error.
      skipDuplicates: true,
    }),
    prisma.characterTag.deleteMany({
      where: { characterId: { in: toClear }, tagId: catatonicTag.id },
    }),
  ]);

  return {
    turnNumber: turn.number,
    enabled: true,
    flagged: flagged.count,
    cleared: toClear.length,
    dms: toFlag.map((character) => ({
      discordUserId: character.discordUserId,
      content: catatonicDm(turns),
    })),
  };
}

module.exports = { runCatatonicPass, catatonicDm };
