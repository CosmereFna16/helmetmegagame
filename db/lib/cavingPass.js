// The Caving Die — see docs/systemdocs/CAVING.md.
//
// Two triggers share the one primitive, rollCaving(): the turn-start pass
// below (runCavingPass, called from db/index.js#resolveNeeds()) rolls for
// every ALIVE character currently standing in a CAVE_LEVEL zone, and
// db/lib/travel.js#performTravel rolls once more on arrival. The
// @@unique([characterId, turnId]) constraint on CavingRoll is what makes
// firing both in the same turn safe — whichever gets there first wins the
// row, and rollCaving swallows the other's P2002 as "already rolled".
//
// Flat 1d6, no Gambit modifier — reuses rollDie() from moveEffects.js so
// there is exactly one d6 in the codebase.
//
//   1       -> TROUBLE. Nothing auto-applies; the row lands unresolved on
//              the Caving lens for a GM to adjudicate (monsters are the
//              GM's call, per the Caving Monsters document), and the player
//              gets one short ominous DM right away.
//   2-5     -> QUIET. Stamped resolved at creation. No DM, no GM attention —
//              the row exists purely as a record.
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

function troubleDm() {
  return "Something is wrong down here. A GM has been notified.";
}

function findDm(tagName) {
  return `You found something: ${tagName}.`;
}

// The single-character primitive, shared by both triggers. `zone` must be a
// CAVE_LEVEL row ({ id, slug }); callers are responsible for that check —
// this function does not re-verify it, since travel.js already knows the
// target zone's kind and the turn pass already filtered its query on it.
//
// Returns { roll, dm } where `roll` is the created CavingRoll (or null if
// this character already rolled this turn — the P2002 race both triggers can
// hit) and `dm` is `{ discordUserId, content } | null` for the caller's own
// side-effect half to send. Never sends anything itself.
async function rollCaving(prisma, character, turn, zone) {
  const die = rollDie(6);
  const kind = die === 1 ? "TROUBLE" : die === 6 ? "FIND" : "QUIET";

  try {
    return await prisma.$transaction(async (tx) => {
      if (kind !== "FIND") {
        const row = await tx.cavingRoll.create({
          data: {
            turnId: turn.id,
            characterId: character.id,
            zoneId: zone.id,
            die,
            kind,
            resolvedAt: kind === "QUIET" ? new Date() : null,
          },
        });
        return {
          roll: row,
          dm: kind === "TROUBLE" ? { discordUserId: character.discordUserId, content: troubleDm() } : null,
        };
      }

      // FIND — draw a tier and a tag, grant it, and file the CAVING_LOOT
      // request in the same transaction as the roll and the grant, so a
      // roll can never exist without its loot (or vice versa).
      const { tier, slug } = drawLoot(zone.slug);
      const tag = await tx.tag.findUnique({ where: { slug }, select: { id: true, name: true, stackable: true } });
      if (!tag) {
        // The catalog is out of sync with cavingLoot.js — refuse to grant a
        // phantom tag. Recorded as TROUBLE-shaped so it still lands on the
        // Caving lens for a GM to notice, rather than vanishing silently.
        console.error(`Caving pass: loot tier "${tier}" drew unknown tag "${slug}" — run npm run db:sync-tags.`);
        const row = await tx.cavingRoll.create({
          data: { turnId: turn.id, characterId: character.id, zoneId: zone.id, die, kind: "TROUBLE" },
        });
        return {
          roll: row,
          dm: { discordUserId: character.discordUserId, content: troubleDm() },
        };
      }

      await addToStack(tx, character.id, tag.id, 1, { source: "EVENT", stackable: tag.stackable });

      const request = await tx.request.create({
        data: {
          characterId: character.id,
          turnId: turn.id,
          type: "CAVING_LOOT",
          reason: `Caving Die find in ${zone.slug}`,
          payload: { zoneId: zone.id, tier },
          effect: { tagId: tag.id, tagName: tag.name, added: 1 },
        },
      });

      const row = await tx.cavingRoll.create({
        data: {
          turnId: turn.id,
          characterId: character.id,
          zoneId: zone.id,
          die,
          kind: "FIND",
          lootTier: tier,
          lootTagId: tag.id,
          lootRequestId: request.id,
          resolvedAt: new Date(),
        },
      });

      return { roll: row, dm: { discordUserId: character.discordUserId, content: findDm(tag.name) } };
    });
  } catch (err) {
    // P2002 on @@unique([characterId, turnId]) — the other trigger (arrival
    // vs. turn-start) already rolled for this character this turn. Not an
    // error; the caller should simply have nothing to report.
    if (err?.code === "P2002") return { roll: null, dm: null };
    throw err;
  }
}

// The turn-start pass. Every ALIVE character standing in a CAVE_LEVEL zone
// gets one roll, unless the arrival trigger already claimed their row this
// turn. One query, then one rollCaving() per character (each its own small
// transaction — see the comment on rollCaving for why the P2002 race is
// harmless). Zero Discord calls; DMs are returned for advanceTurn()'s
// side-effect thunk to send sequentially, same discipline as every other
// pass.
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
    const { roll, dm } = await rollCaving(prisma, character, turn, character.zone);
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

module.exports = { rollCaving, runCavingPass };
