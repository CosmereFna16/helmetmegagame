// The Caving Die — see docs/systemdocs/CAVING.md.
//
// Two triggers share rollCaving(): runCavingPass (turn-start, every ALIVE
// character already in a CAVE_LEVEL zone) and rollCavingOnArrival() (any
// path that lands a character in one). Arrival is a BONUS roll on top of
// turn-start, not a substitute — @@unique([characterId, turnId, trigger])
// caps each trigger at one hit per character per turn, and rollCaving
// swallows its own trigger's repeat P2002 as "already rolled".

// Takes `prisma` as a parameter — see db/lib/dm.js for why.
const { drawLoot } = require("./cavingLoot");
const { addToStack } = require("./tagWrites");
const { rollDie } = require("./moveEffects");
const { expiryFrom } = require("./turnFormat");

// Every DM leads with the face, so a player sees their own roll and not just
// its outcome — including QUIET, so nobody wonders whether the die rolled.
function quietDm(die) {
  return `Caving Die: ${die} — Nothing happens.`;
}

function troubleDm(die) {
  return `Caving Die: ${die} — Something is wrong down here. A GM has been notified.`;
}

function findDm(die, tagName) {
  return `Caving Die: ${die} — You found something: ${tagName}.`;
}

// The single-character primitive, shared by both triggers. `zone` must be a
// CAVE_LEVEL row ({ id, slug }); callers are responsible for that check.
// Returns { roll, dm } — `roll` is null if this trigger already rolled for
// this character this turn (P2002); never sends the DM itself.
async function rollCaving(prisma, character, turn, zone, trigger) {
  const die = rollDie(6);
  const kind = die === 1 ? "TROUBLE" : die === 6 ? "FIND" : "QUIET";

  try {
    return await prisma.$transaction(async (tx) => {
      if (kind !== "FIND") {
        const row = await tx.cavingRoll.create({
          data: {
            turnId: turn.id,
            characterId: character.id,
            trigger,
            zoneId: zone.id,
            die,
            kind,
            resolvedAt: kind === "QUIET" ? new Date() : null,
          },
        });
        return {
          roll: row,
          dm: {
            discordUserId: character.discordUserId,
            content: kind === "TROUBLE" ? troubleDm(die) : quietDm(die),
          },
        };
      }

      // FIND — draw a tier and a tag, grant it, and file the CAVING_LOOT
      // request in the same transaction as the roll and the grant, so a
      // roll can never exist without its loot (or vice versa).
      const { tier, slug } = drawLoot(zone.slug);
      const tag = await tx.tag.findUnique({
        where: { slug },
        select: { id: true, name: true, stackable: true, defaultDurationTurns: true },
      });
      if (!tag) {
        // The catalog is out of sync with cavingLoot.js — refuse to grant a
        // phantom tag. Recorded as TROUBLE-shaped so it still lands on the
        // Caving lens for a GM to notice, rather than vanishing silently.
        console.error(`Caving pass: loot tier "${tier}" drew unknown tag "${slug}" — run npm run db:sync-tags.`);
        const row = await tx.cavingRoll.create({
          data: { turnId: turn.id, characterId: character.id, trigger, zoneId: zone.id, die, kind: "TROUBLE" },
        });
        return {
          roll: row,
          dm: { discordUserId: character.discordUserId, content: troubleDm(die) },
        };
      }

      // `turn.number`, NOT turn.number + 1: unlike hungerPass/tagExpiryPass/
      // moveEffects, `turn` here IS already the first live turn. Nothing in
      // cavingLoot.js's table is timed today; this stamps null either way.
      await addToStack(tx, character.id, tag.id, 1, {
        source: "EVENT",
        stackable: tag.stackable,
        expiresTurn: expiryFrom(turn.number, tag.defaultDurationTurns),
      });

      const request = await tx.request.create({
        data: {
          characterId: character.id,
          turnId: turn.id,
          type: "CAVING_LOOT",
          reason: `Caving Die find in ${zone.slug}`,
          payload: { zoneId: zone.id, tier, die },
          effect: { tagId: tag.id, tagName: tag.name, added: 1 },
        },
      });

      const row = await tx.cavingRoll.create({
        data: {
          turnId: turn.id,
          characterId: character.id,
          trigger,
          zoneId: zone.id,
          die,
          kind: "FIND",
          lootTier: tier,
          lootTagId: tag.id,
          lootRequestId: request.id,
          resolvedAt: new Date(),
        },
      });

      return { roll: row, dm: { discordUserId: character.discordUserId, content: findDm(die, tag.name) } };
    });
  } catch (err) {
    // P2002 on @@unique([characterId, turnId, trigger]) — THIS trigger already
    // rolled for this character this turn. Not an error; the other trigger
    // firing the same turn is fine and expected (the bonus-roll design).
    if (err?.code === "P2002") return { roll: null, dm: null };
    throw err;
  }
}

// The arrival trigger, for every path that lands a character in a zone —
// player travel, fast travel, and raw GM relocations alike. Bails quietly on
// a non-cave zone, no open turn, or any error: a caving roll must never fail
// the move that caused it. Returns the caller's DM to send, or null.
async function rollCavingOnArrival(prisma, character, zone) {
  if (zone?.kind !== "CAVE_LEVEL") return null;

  const turn = await prisma.turn.findFirst({ where: { status: "OPEN" } });
  if (!turn) return null;

  try {
    const { dm } = await rollCaving(prisma, character, turn, zone, "ARRIVAL");
    return dm;
  } catch (err) {
    console.error(`Caving arrival roll failed for character ${character.id}:`, err);
    return null;
  }
}

// The turn-start pass, run by advanceTurn() (db/index.js) against the turn it
// just opened — NOT the one being closed. Every ALIVE character already
// standing in a CAVE_LEVEL zone gets one roll. Zero Discord calls; DMs are
// returned for advanceTurn()'s side-effect thunk to send sequentially.
async function runCavingPass(prisma, turn) {
  const characters = await prisma.character.findMany({
    where: { status: "ALIVE", zone: { kind: "CAVE_LEVEL" } },
    select: { id: true, discordUserId: true, zoneId: true, zone: { select: { id: true, slug: true } } },
  });

  let trouble = 0;
  let finds = 0;
  let quiet = 0;
  let alreadyRolled = 0;
  const dms = [];

  for (const character of characters) {
    const { roll, dm } = await rollCaving(prisma, character, turn, character.zone, "TURN_START");
    if (!roll) {
      alreadyRolled += 1;
      continue;
    }
    if (roll.kind === "TROUBLE") trouble += 1;
    else if (roll.kind === "FIND") finds += 1;
    else quiet += 1;
    if (dm) dms.push(dm);
  }

  return { rolled: characters.length - alreadyRolled, trouble, finds, quiet, alreadyRolled, dms };
}

module.exports = { rollCaving, rollCavingOnArrival, runCavingPass };
