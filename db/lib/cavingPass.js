// The Caving Die — see docs/systemdocs/CAVING.md.
//
// WALKING is what wakes the dark. There is one trigger — rollCavingOnArrival(),
// fired by every path that lands a character on a Location in a CAVE_LEVEL
// zone, going deeper or retreating alike. Standing still costs nothing: the
// old turn-start pass is gone, because it punished the one thing a cave should
// reward, which is not moving.
//
// @@unique([characterId, turnId, trigger, locationId]) caps it at one roll per
// LOCATION per turn, and rollCaving swallows that repeat's P2002 as "already
// rolled" — so a character pacing between two places pays for each of them
// once and then walks in silence.

// Takes `prisma` as a parameter — see db/lib/dm.js for why.
const { drawLoot } = require("./cavingLoot");
const { hasAttribute, SAFE_ATTRIBUTE } = require("./locationAttributes");
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

// The single-character primitive. `location` must be a Location row
// ({ id, attributes, zone }) whose zone is a CAVE_LEVEL; the caller is
// responsible for that check. Returns { roll, dm } — `roll` is null if this
// character already rolled for this Location this turn (P2002); never sends
// the DM itself.
async function rollCaving(prisma, character, turn, location, trigger) {
  const zone = location.zone;
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
            locationId: location.id,
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
          data: {
            turnId: turn.id,
            characterId: character.id,
            trigger,
            zoneId: zone.id,
            locationId: location.id,
            die,
            kind: "TROUBLE",
          },
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
          locationId: location.id,
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
    // P2002 on @@unique([characterId, turnId, trigger, locationId]) — this
    // character already rolled for THIS Location this turn. Not an error: it
    // is the anti-pacing rule, and walking back into somewhere you already
    // saw today is meant to be quiet.
    if (err?.code === "P2002") return { roll: null, dm: null };
    throw err;
  }
}

// The one trigger, for every path that lands a character on a Location —
// player travel, dragging, and raw GM relocations alike. Bails quietly on a
// surface Location, a SAFE one, no open turn, or any error at all: a caving
// roll must never fail the move that caused it. Returns the caller's DM to
// send, or null.
//
// `location` needs { id, attributes, zone: { id, slug, kind } }.
async function rollCavingOnArrival(prisma, character, location) {
  if (location?.zone?.kind !== "CAVE_LEVEL") return null;
  // Customs is the cave mouth with a sentry, a floodlight and a shop in it.
  // Nothing stalks a place that busy, and the attribute says so rather than
  // this file naming the slug — see db/lib/locationAttributes.js.
  if (hasAttribute(location, SAFE_ATTRIBUTE)) return null;

  const turn = await prisma.turn.findFirst({ where: { status: "OPEN" } });
  if (!turn) return null;

  try {
    const { dm } = await rollCaving(prisma, character, turn, location, "ARRIVAL");
    return dm;
  } catch (err) {
    console.error(`Caving arrival roll failed for character ${character.id}:`, err);
    return null;
  }
}

module.exports = { rollCaving, rollCavingOnArrival };
