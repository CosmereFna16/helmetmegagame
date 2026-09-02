// The Caving Die — see docs/systemdocs/CAVING.md.
//
// Two triggers share the one primitive, rollCaving(): the turn-start pass
// below (runCavingPass, called from db/index.js#advanceTurn() against the
// turn it just opened) rolls for every ALIVE character already standing in a
// CAVE_LEVEL zone, and rollCavingOnArrival() rolls again the moment anything
// lands a character in one — player travel (db/lib/travel.js#performTravel)
// and the raw GM relocations alike (the Dev Panel's zone edit, Bulk Move,
// fast travel), so being dropped into the Depths by a GM is never a free
// walk in. Arrival is a BONUS roll on top of the turn-start one, not a
// substitute for it: someone standing in the Depths when the turn opens gets
// the pass's roll, and someone who walks in mid-turn gets a second one. The
// @@unique([characterId, turnId, trigger]) constraint on CavingRoll caps each
// trigger at one hit per character per turn — rollCaving swallows its own
// trigger's repeat P2002 as "already rolled", which is what stops a
// bounced-around character (free travel, a GM's Bulk Move) from farming more
// than the two.
//
// Flat 1d6, no Gambit modifier — reuses rollDie() from moveEffects.js so
// there is exactly one d6 in the codebase.
//
//   1       -> TROUBLE. Nothing auto-applies; the row lands unresolved on
//              the Caving lens for a GM to adjudicate (monsters are the
//              GM's call, per the Caving Monsters document), and the player
//              gets one short ominous DM right away.
//   2-5     -> QUIET. Stamped resolved at creation. No GM attention — the
//              row exists as a record — but the player still gets a one-line
//              DM with the face, so nobody wonders whether the die rolled.
//   6       -> FIND. Draws a loot tier off db/lib/cavingLoot.js, grants the
//              tag through a system-filed CAVING_LOOT Request (PASSED by
//              default, same apply-first-review-after pattern every other
//              request follows — see docs/systemdocs/REQUESTS.md), and DMs
//              the player what they found.
//
// Takes `prisma` as a parameter — see db/lib/dm.js for why (db/index.js
// requiring itself back from db/lib/ would resolve to a partial exports
// object).
const { drawLoot } = require("./cavingLoot");
const { addToStack } = require("./tagWrites");
const { rollDie } = require("./moveEffects");
const { expiryFrom } = require("./turnFormat");

// Every DM leads with the face, so a player sees their own roll and not just
// its outcome. A QUIET (2-5) used to send nothing, which left players unsure
// whether the die had rolled at all — so it now says so, briefly.
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
// CAVE_LEVEL row ({ id, slug }); callers are responsible for that check —
// this function does not re-verify it, since travel.js already knows the
// target zone's kind and the turn pass already filtered its query on it.
// `trigger` is "TURN_START" or "ARRIVAL" (CavingTrigger) — see the module
// header for what separates them.
//
// Returns { roll, dm } where `roll` is the created CavingRoll (or null if
// this trigger already rolled for this character this turn — the P2002 a
// retried pass, two racing advances, or a bounced-around arrival can hit)
// and `dm` is `{ discordUserId, content } | null` for the caller's own
// side-effect half to send. Never sends anything itself.
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

      // `turn.number`, NOT turn.number + 1. hungerPass, tagExpiryPass,
      // moveEffects and db/index.js's stack reroll all grant against the turn
      // being CLOSED, so they add 1 to reach the tag's first live turn. Caving
      // never does: runCavingPass is handed newTurn — already open — and
      // rollCavingOnArrival looks up the OPEN turn itself and bails if there
      // isn't one. Here `turn` IS the first live turn, so adding 1 would give
      // every timed find an extra turn on the sheet.
      //
      // Nothing in cavingLoot.js's table is timed today, so this stamps null
      // either way; it exists so the first timed tag added to that table
      // doesn't land permanent (a null expiresTurn never matches the sweep's
      // `lte`, which is how a tag becomes permanent by accident).
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
    // rolled for this character this turn (a retried pass, two advances
    // racing, or a character bounced between zones by the same trigger more
    // than once). Not an error; the caller should simply have nothing to
    // report. The other trigger firing the same turn is fine and expected —
    // that's the bonus-roll design, not a race to guard against.
    if (err?.code === "P2002") return { roll: null, dm: null };
    throw err;
  }
}

// The arrival trigger, for every path that lands a character in a zone —
// player travel (db/lib/travel.js#performTravel), fast travel
// (web/app/(app)/character/requestActions.js), and the raw GM relocations
// alike (the Dev Panel's zone edit, Bulk Move). A bonus roll on top of
// whatever the turn-start pass already gave this character this turn — see
// the module header. Not the staged "Relocate to": the pass re-reads live
// zones after the new turn opens, so a character pushed into the Depths is
// caught by the *next* turn's pass, and rollCaving can't open its transaction
// inside the row's own one anyway.
//
// Bails quietly on a non-cave zone, on no open turn (mid-restart — the next
// turn's pass or the next arrival catches them), and on any error: a caving
// roll must never fail the move that caused it. Returns the caller's DM to
// send, or null; sends nothing itself, same split as everything else here.
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
// standing in a CAVE_LEVEL zone gets one roll; an arrival roll made earlier
// this same turn does not block it, since the two triggers no longer share a
// dedupe key (see the module header). One query, then one rollCaving() per
// character (each its own small transaction — see the comment on rollCaving
// for why a repeat P2002 is harmless). Zero Discord calls; DMs are returned
// for advanceTurn()'s side-effect thunk to send sequentially, same discipline
// as every other pass.
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
