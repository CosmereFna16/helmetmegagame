// The Caving Die's loot table — code, not YAML, because this is mechanics
// (a weighted draw) rather than player-facing catalog data. See
// docs/systemdocs/CAVING.md for the full table and the reasoning behind the
// weights. db/lib/cavingPass.js is the only caller.
//
// Two-stage draw on a roll of 6: pick a tier by the standing zone's column
// below, then pick uniformly among that tier's slugs. Slugs are validated
// against the live Tag catalog by validateCavingLoot() — call that once at
// startup (bot/src/index.js and web's instrumentation hook), not per-roll,
// so a typo fails loud instead of handing a player nothing on the one 6
// they rolled all week.

const TIERS = ["ultracommon", "common", "uncommon", "rare", "extremely-rare", "nearly-impossible"];

// Column sums to 1 (checked by validateCavingLoot).
// Two columns since the Bascinet 2 map, which replaced the three cave levels
// (Caverns / Railroad / Aberrant Pits) with two: Caves and Depths. Caves keeps
// the old Caverns column unchanged. Depths takes the old Aberrant Pits column
// unchanged, rather than the middle Railroad one, because it is now the only
// deep place on the map and has to carry what all three tiers below the
// surface used to.
const WEIGHTS_BY_ZONE = {
  caves: {
    ultracommon: 0.65,
    common: 0.25,
    uncommon: 0.08,
    rare: 0.0195,
    "extremely-rare": 0,
    "nearly-impossible": 0.0005,
  },
  depths: {
    ultracommon: 0.15,
    common: 0.22,
    uncommon: 0.28,
    rare: 0.25,
    "extremely-rare": 0.07,
    "nearly-impossible": 0.03,
  },
};

// Tier contents, by slug. Weapon/armor tiers pull representative slugs off
// SMITHING.md §3/§4's ladder (Dead Simple/Simple -> Moderate/High Quality ->
// Exceptional/Gunpowder) rather than every entry in it.
const LOOT_TABLE = {
  ultracommon: ["cave-fungus", "saltpeter"],
  common: ["cudgel", "purse", "cracked-bone-club", "sling", "skinned-cave-rat", "old-coin"],
  uncommon: [
    "alcohol",
    "cleaning-powder",
    "fine-meal",
    "bear-trap",
    "hatchet",
    "dagger",
    "padded-armor",
    "mail-coif",
  ],
  rare: [
    "ravenheart-red",
    "cat",
    "salvage-plate",
    "supply-kit",
    "jewelry",
    "bliss",
    "spyglass",
    "gas-mask",
    "broadsword",
    "war-hammer",
  ],
  "extremely-rare": [
    "emp-grenade",
    "smithing-gunpowder",
    "skeleton-wedge",
    "jester-outfit",
    "starting-wares",
    "military-autoinjector",
    "autocannon-shell",
    "zweihander",
    "crossbow",
  ],
  "nearly-impossible": ["energy-shield", "power-fist", "neoclassic-rw10", "stepstone", "dark-eye-lenses", "motorcycle"],
};

// Validated once at process startup against the live Tag catalog (see
// bot/src/index.js and web's instrumentation.js), not on every roll —
// throwing here means "the loot table references something that isn't in
// docs/tags.yaml", which should fail the deploy, not the next player's roll.
async function validateCavingLoot(prisma) {
  const allSlugs = new Set(Object.values(LOOT_TABLE).flat());
  const found = await prisma.tag.findMany({ where: { slug: { in: [...allSlugs] } }, select: { slug: true } });
  const foundSlugs = new Set(found.map((t) => t.slug));
  const missing = [...allSlugs].filter((s) => !foundSlugs.has(s));
  if (missing.length) {
    throw new Error(`db/lib/cavingLoot.js: LOOT_TABLE references unknown tag slug(s): ${missing.join(", ")}`);
  }
  for (const [zoneSlug, weights] of Object.entries(WEIGHTS_BY_ZONE)) {
    const sum = TIERS.reduce((total, tier) => total + (weights[tier] ?? 0), 0);
    if (Math.abs(sum - 1) > 1e-6) {
      throw new Error(`db/lib/cavingLoot.js: WEIGHTS_BY_ZONE["${zoneSlug}"] sums to ${sum}, not 1`);
    }
  }
}

// Draws a tier for the given cave-level zone slug (caves/depths), then a slug
// uniformly within it. Returns { tier, slug }.
function drawLoot(zoneSlug) {
  const weights = WEIGHTS_BY_ZONE[zoneSlug];
  if (!weights) throw new Error(`db/lib/cavingLoot.js: no loot weights for zone "${zoneSlug}"`);
  let roll = Math.random();
  let tier = TIERS[TIERS.length - 1];
  for (const t of TIERS) {
    const w = weights[t] ?? 0;
    if (roll < w) {
      tier = t;
      break;
    }
    roll -= w;
  }
  const pool = LOOT_TABLE[tier];
  const slug = pool[Math.floor(Math.random() * pool.length)];
  return { tier, slug };
}

module.exports = { LOOT_TABLE, validateCavingLoot, drawLoot };
