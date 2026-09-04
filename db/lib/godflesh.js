// Cutting Godflesh out of the marsh: the die, the yield, and the hand you
// might not come back with.
//
// Modelled on db/lib/depotTurret.js, and deliberately so — the two are the
// same shape of problem (a thing that hurts you, with armour deciding HOW
// badly rather than WHETHER). What is different is the entry: the turret rolls
// its table every time, and this one only reaches the table on a 1. Extracting
// is meant to be routine work that occasionally takes a finger, not a coin
// flip with your body.
//
// Pure and Prisma-free, like the turret: the caller loads the tags and writes
// the result, and this decides only what happens. See
// docs/systemdocs/FACTORY.md.

// Anything that can cut. The Chainsaw is also the only one that doubles the
// yield, which is what a player is paying the Depot 154 ¢ for.
const EXTRACT_TOOLS = ["chainsaw", "battle-axe", "hatchet"];
const CHAINSAW_SLUG = "chainsaw";
const ARMORED_GLOVES_SLUG = "armored-gloves";
const GODFLESH_SLUG = "godflesh";

// The whole difference between keeping your fingers and not. Gloves are 2 ⬢ to
// craft and every Factory role starts with a pair, so a mangled hand is nearly
// always somebody who took them off to work faster.
//
// Columns sum to 1. `null` is "hurt, but nothing that leaves a mark".
const INJURY_TABLE = {
  none: { "missing-fingers": 0.45, "mangled-hand": 0.4, "missing-arm": 0.15 },
  gloves: { "minor-wound": 0.75, "deep-wound": 0.25 },
  "gloves-armored": { "minor-wound": 0.9, "deep-wound": 0.1 },
};

// Body armour on top of the gloves. Same priority-order idea as the turret's
// tiers, but there are only two answers here: something between the mouths and
// you, or nothing.
const BODY_ARMOR_SLUGS = [
  "plate-armor", "breastplate", "brigandine", "mail-shirt", "salvage-plate",
  "light-infantry-armour", "padded-armor",
];

const SUM_EPSILON = 0.0001;

for (const [key, column] of Object.entries(INJURY_TABLE)) {
  const sum = Object.values(column).reduce((a, b) => a + b, 0);
  if (Math.abs(sum - 1) > SUM_EPSILON) {
    throw new Error(`godflesh.js: injury column "${key}" sums to ${sum}, not 1`);
  }
}

// Equipped only, same rule as the turret and db/lib/laborAccess.js's tools: a
// pair of gloves at the bottom of a sack protects nobody.
function equippedSlugSet(characterTags = []) {
  return new Set(
    characterTags
      .filter((ct) => ct?.equipped === true)
      .map((ct) => ct?.tag?.slug ?? ct?.slug)
      .filter(Boolean),
  );
}

// Which blade is in their hands, or null. Returned rather than a boolean so
// the DM can name it and the yield can read the Chainsaw off it.
function extractToolFor(characterTags = []) {
  const worn = equippedSlugSet(characterTags);
  return EXTRACT_TOOLS.find((slug) => worn.has(slug)) ?? null;
}

function injuryColumnFor(characterTags = []) {
  const worn = equippedSlugSet(characterTags);
  if (!worn.has(ARMORED_GLOVES_SLUG)) return "none";
  return BODY_ARMOR_SLUGS.some((slug) => worn.has(slug)) ? "gloves-armored" : "gloves";
}

// One day's extraction. `rng` is injectable so a test can pin the outcome;
// nothing in production passes it.
//
// Returns { die, tool, quantity, injury: { column, tagSlug } | null }.
function rollExtraction(characterTags, rng = Math.random) {
  const tool = extractToolFor(characterTags);
  const die = 1 + Math.floor(rng() * 6);

  // A Chainsaw is worth two. A 6 is worth one more on top of whatever you
  // were already going to get, so the good day is good for everybody.
  let quantity = tool === CHAINSAW_SLUG ? 2 : 1;
  if (die === 6) quantity += 1;

  if (die !== 1) return { die, tool, quantity, injury: null };

  const column = injuryColumnFor(characterTags);
  let roll = rng();
  for (const [tagSlug, weight] of Object.entries(INJURY_TABLE[column])) {
    roll -= weight;
    if (roll <= 0) return { die, tool, quantity, injury: { column, tagSlug } };
  }
  // Only reachable on a column that sums under 1, which the assertion above
  // rejects at require time. The mildest outcome is the harmless direction.
  const [mildest] = Object.keys(INJURY_TABLE[column]);
  return { die, tool, quantity, injury: { column, tagSlug: mildest } };
}

// What the player is told. One `-#` line under the result, the house wording
// for "here is why your number is the size it is" (db/lib/laborAccess.js).
function extractionDm(result, { locationName = null } = {}) {
  const where = locationName ? ` at ${locationName}` : "";
  const lines = [`*You went out into the marsh${where} and cut.*`, `**Roll (1d6):** ${result.die}`];

  if (result.injury) {
    lines.push(
      "» *It got a hand round your wrist before you got the blade in.* ‡",
      result.injury.column === "none"
        ? "-# You were not wearing your Armored Gloves. ‡"
        : "-# Your Armored Gloves took most of it. ‡",
    );
  } else if (result.die === 6) {
    lines.push("» *A good seam. It came away in one piece and then some.* ‡");
  }

  lines.push(`**Godflesh:** +${result.quantity}`);
  return lines.join("\n");
}

module.exports = { GODFLESH_SLUG, extractToolFor, rollExtraction, extractionDm };
