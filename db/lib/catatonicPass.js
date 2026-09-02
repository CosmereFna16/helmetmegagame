// Catatonic (AFK) upkeep, run from db/index.js#resolveNeeds() so the bot's
// cron advance and the Dev Panel's "End turn" button behave identically.
//
// Flags any ALIVE character whose lastActivityTurn is stale past
// GameConfig.catatonicTurns with the `catatonic-afk` tag, and clears it once
// their clock moves again. catatonicSinceTurn drives
// db/lib/catatonicDeathPass.js's auto-kill; the tag itself is removable:
// false. Shaped for 100+ players: no network call, DMs/role updates returned
// for advanceTurn() to apply. Takes `prisma` as a parameter — see db/lib/dm.js.
const { CATATONIC_SLUG } = require("./constants");
const { formatBareName } = require("./characterName");
const { characterRoleAppearance } = require("./characterRoleAppearance");

function catatonicDm(turns, deathTurns) {
  const deathLine =
    deathTurns > 0
      ? ` If you stay **Catatonic** for ${deathTurns} more turns, your character dies.`
      : "";
  return (
    `You've been quiet for ${turns} turns. You've gone **Catatonic** — it lifts the moment ` +
    `you act or speak in character again.${deathLine}`
  );
}

async function runCatatonicPass(prisma, turn) {
  const config = await prisma.gameConfig.findUnique({ where: { id: 1 } });

  // Off is a real, supported state — return an object, not null. null means
  // "did not run, retry it forever," and would wedge the turn permanently on
  // a game that has this switched off on purpose.
  if (!config?.catatonicEnabled) {
    return { turnNumber: turn.number, enabled: false, flagged: 0, cleared: 0, dms: [], roleUpdates: [] };
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
      // For the returned roleUpdates: the personal role to rename, and the
      // name parts characterRoleAppearance composes from.
      discordRoleId: true,
      firstName: true,
      lastName: true,
      // For the stale test below and the catatonicSinceTurn stamping.
      leftGuildAt: true,
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
    // A departed player is stale regardless of their clock, since it can
    // never move again — without this, playerDeparture.js's grant would be
    // cleared at the very next close. guildMemberAdd nulls leftGuildAt on
    // rejoin, and the ordinary clock takes over from there.
    const stale = character.leftGuildAt != null || lastActivityTurn <= threshold;
    const held = character.tags.length > 0;

    if (stale && !held) toFlag.push(character);
    else if (!stale && held) toClear.push(character);
  }

  // One transaction so a character can never be left flagged-and-cleared out
  // of step with itself.
  const [flagged] = await prisma.$transaction([
    prisma.characterTag.createMany({
      // expiresTurn: null, unlike Hunger — this pass owns both the grant and
      // the clear itself, so there is no sweep to hand an expiry to. A
      // turn-count expiry here would flicker the tag off for a turn even
      // though the character is still stale.
      data: toFlag.map((character) => ({
        characterId: character.id,
        tagId: catatonicTag.id,
        source: "EVENT",
        expiresTurn: null,
      })),
      // Keep a re-grant a no-op rather than a unique constraint error, in
      // case a prior clear was missed mid-transaction.
      skipDuplicates: true,
    }),
    prisma.characterTag.deleteMany({
      where: { characterId: { in: toClear.map((character) => character.id) }, tagId: catatonicTag.id },
    }),
    // The death countdown's clock (db/lib/catatonicDeathPass.js). Stamped
    // only where currently null, so a character playerDeparture.js already
    // put on the clock — or one re-flagged after a half-failed clear — keeps
    // the countdown they were on rather than getting a fresh one.
    prisma.character.updateMany({
      where: { id: { in: toFlag.map((character) => character.id) }, catatonicSinceTurn: null },
      data: { catatonicSinceTurn: turn.number },
    }),
    prisma.character.updateMany({
      where: { id: { in: toClear.map((character) => character.id) } },
      data: { catatonicSinceTurn: null },
    }),
  ]);

  // The personal-role renames this pass owes Discord — suffixed grey for the
  // newly flagged, bare name + hash colour back for the cleared. Returned,
  // not performed: advanceTurn() applies them next to the DMs, keeping this
  // pass network-free.
  const roleUpdate = (character, catatonic) => {
    const bare = formatBareName(character);
    if (!character.discordRoleId || !bare) return null;
    return { roleId: character.discordRoleId, ...characterRoleAppearance(bare, { catatonic }) };
  };
  const roleUpdates = [
    ...toFlag.map((character) => roleUpdate(character, true)),
    ...toClear.map((character) => roleUpdate(character, false)),
  ].filter(Boolean);

  return {
    turnNumber: turn.number,
    enabled: true,
    flagged: flagged.count,
    cleared: toClear.length,
    dms: toFlag
      // No DM for a departed player — the account is gone; the send would
      // only 403 into the REST breaker's tally.
      .filter((character) => character.leftGuildAt == null)
      .map((character) => ({
        discordUserId: character.discordUserId,
        content: catatonicDm(turns, Math.max(0, config.catatonicDeathTurns ?? 0)),
      })),
    roleUpdates,
  };
}

module.exports = { runCatatonicPass, catatonicDm };
