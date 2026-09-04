// The Depot's indoor turret: the first automated harm mechanic in Bascinet.
//
// Nothing else in this codebase rolls damage. Injuries have always been either
// GM-adjudicated (HARM_CHARACTER) or a narrative Gambit outcome, so there was
// no armour model to extend and no damage table to reuse. What this borrows
// instead is the SHAPE of db/lib/cavingLoot.js: a weighted draw whose columns
// are asserted to sum to 1 once at startup rather than per roll, so a mistuned
// table fails loudly on boot instead of quietly skewing a month of play.
//
// Two things about it are deliberate and easy to get wrong.
//
// It reads FACES, not papers. The turret spares exactly one thing: a character
// whose PRESENTED name matches Depot.merchantFace. Not the licence, not the
// keycard, not the role. So a concealed Merchant is shot by his own gun, a
// Docker who steals the card is still shot, and anyone who comes back wearing
// the Merchant's name walks past it. That trap is the point of the feature.
//
// It is the whole distribution that moves, not a single step. Armour picks a
// COLUMN, so a vest does not merely downgrade a grievous wound to a deep one —
// it makes a graze the likely outcome and a death nearly impossible. That
// reads better at the table than subtracting one rung, and it lets a GM retune
// lethality per tier without touching code.

// Worst to best. `null` is a clean miss with a story attached; `dead` is
// handled by the caller, since killing a character is not a tag grant.
const TURRET_SEVERITIES = ["graze", "minor-wound", "deep-wound", "grievous-wound", "dying", "dead"];

// The tag each severity applies. Graze marks nobody — it is the near miss that
// makes the gun frightening without making it a shredder — and dead is the
// caller's problem.
const TURRET_SEVERITY_TAGS = {
  graze: null,
  "minor-wound": "minor-wound",
  "deep-wound": "deep-wound",
  "grievous-wound": "grievous-wound",
  dying: "dying",
  dead: null,
};

// Armour columns, best protection FIRST. The first slug a character has
// equipped picks their column, so the ladder is a priority order rather than a
// score — someone in plate under a vest gets the vest's column, which is right,
// because the vest is the thing stopping the round.
//
// Light Infantry Armour is the best column by a distance and that is the
// catalog's own claim about it: "nothing forged in Ravenheart stops a bullet."
// The turret is where that line finally means something mechanical.
const TURRET_ARMOR_TIERS = [
  { key: "energy-shield", slugs: ["energy-shield"], label: "Energy Shield" },
  { key: "light-infantry", slugs: ["light-infantry-armour"], label: "Light Infantry Armour" },
  { key: "salvage-plate", slugs: ["salvage-plate"], label: "Salvage Plate" },
  { key: "plate", slugs: ["plate-armor", "breastplate", "brigandine"], label: "Plate" },
  { key: "mail", slugs: ["mail-shirt", "mail-coif"], label: "Mail" },
  { key: "padded", slugs: ["padded-armor", "padded-cap"], label: "Padded" },
  { key: "none", slugs: [], label: "No armour" },
];

// The shipped tuning. Every column sums to 1. A GM overrides any part of this
// from the Dev Panel's Depot section; Depot.turretTable holds the override and
// anything it omits falls back to here, so a half-filled table is still valid.
const DEFAULT_TURRET_TABLE = {
  none: { graze: 0.1, "minor-wound": 0.25, "deep-wound": 0.3, "grievous-wound": 0.2, dying: 0.1, dead: 0.05 },
  padded: { graze: 0.25, "minor-wound": 0.3, "deep-wound": 0.25, "grievous-wound": 0.13, dying: 0.05, dead: 0.02 },
  mail: { graze: 0.3, "minor-wound": 0.3, "deep-wound": 0.23, "grievous-wound": 0.11, dying: 0.04, dead: 0.02 },
  plate: { graze: 0.38, "minor-wound": 0.3, "deep-wound": 0.19, "grievous-wound": 0.09, dying: 0.03, dead: 0.01 },
  "salvage-plate": { graze: 0.45, "minor-wound": 0.29, "deep-wound": 0.16, "grievous-wound": 0.07, dying: 0.02, dead: 0.01 },
  "light-infantry": { graze: 0.55, "minor-wound": 0.28, "deep-wound": 0.12, "grievous-wound": 0.04, dying: 0.01, dead: 0 },
  "energy-shield": { graze: 0.85, "minor-wound": 0.1, "deep-wound": 0.04, "grievous-wound": 0.01, dying: 0, dead: 0 },
};

// Floating point will not give you exactly 1.0 from six decimals, so the
// assertion has to have a tolerance. Same posture as cavingLoot's column sums.
const SUM_EPSILON = 0.0001;

function columnSumsToOne(column) {
  let sum = 0;
  for (const [key, weight] of Object.entries(column)) {
    if (!TURRET_SEVERITIES.includes(key)) return false;
    if (typeof weight !== "number" || Number.isNaN(weight) || weight < 0) return false;
    sum += weight;
  }
  return Math.abs(sum - 1) <= SUM_EPSILON;
}

// A GM's stored table merged over the defaults, column by column. A column the
// override does not mention keeps its shipped weights entirely; a column it
// does mention is taken WHOLE rather than merged key-by-key, because a
// half-overridden column would silently stop summing to 1.
function turretTable(depot) {
  const stored = depot?.turretTable;
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) return DEFAULT_TURRET_TABLE;
  const merged = { ...DEFAULT_TURRET_TABLE };
  for (const tier of TURRET_ARMOR_TIERS) {
    const column = stored[tier.key];
    if (!column || typeof column !== "object") continue;
    // Belt and braces against a column written by something other than the
    // validated Dev Panel form — a hand-edited row, a restored backup from
    // before a severity was renamed. A column that cannot be rolled against
    // falls back to the shipped one rather than quietly skewing every shot.
    if (!columnSumsToOne(column)) continue;
    merged[tier.key] = column;
  }
  return merged;
}

// Throws on a table that cannot be rolled against.
//
// The write path is where this runs: web/app/(app)/gm/dev/actions.js#updateDepot
// refuses a save whose columns do not sum to 1, so a mistuned table never
// reaches the database in the first place. That is deliberately stricter than
// validating at startup — by then the bad odds are already live, and a GM
// staring at a rejected form is told exactly which column is wrong while they
// still have it in front of them.
function validateTurretTable(table = DEFAULT_TURRET_TABLE) {
  for (const tier of TURRET_ARMOR_TIERS) {
    const column = table[tier.key];
    if (!column) throw new Error(`Depot turret table: no column for armour tier "${tier.key}"`);
    let sum = 0;
    for (const severity of TURRET_SEVERITIES) {
      const w = column[severity];
      if (w === undefined) continue;
      if (typeof w !== "number" || Number.isNaN(w) || w < 0) {
        throw new Error(`Depot turret table: column "${tier.key}" has a bad weight for "${severity}"`);
      }
      sum += w;
    }
    for (const key of Object.keys(column)) {
      if (!TURRET_SEVERITIES.includes(key)) {
        throw new Error(`Depot turret table: column "${tier.key}" has unknown severity "${key}"`);
      }
    }
    if (Math.abs(sum - 1) > SUM_EPSILON) {
      throw new Error(`Depot turret table: column "${tier.key}" sums to ${sum}, not 1`);
    }
  }
  return true;
}

// Which column this character rolls on. Accepts the CharacterTag[] shape used
// everywhere else (`{ tag: { slug }, equipped }`) and tolerates a bare Tag[].
//
// Armour only counts EQUIPPED. A vest in your cart does not stop anything, and
// letting it would make the turret trivially survivable by shopping.
function armorTierFor(characterTags = []) {
  const worn = new Set(
    characterTags
      .filter((ct) => ct?.equipped !== false)
      .map((ct) => ct?.tag?.slug ?? ct?.slug)
      .filter(Boolean),
  );
  for (const tier of TURRET_ARMOR_TIERS) {
    if (tier.slugs.some((slug) => worn.has(slug))) return tier;
  }
  return TURRET_ARMOR_TIERS[TURRET_ARMOR_TIERS.length - 1];
}

// One shot. `rng` is injectable so a test can pin the outcome; nothing in
// production passes it.
function rollTurret(characterTags, depot, rng = Math.random) {
  const tier = armorTierFor(characterTags);
  const column = turretTable(depot)[tier.key] ?? DEFAULT_TURRET_TABLE.none;

  let roll = rng();
  for (const severity of TURRET_SEVERITIES) {
    roll -= column[severity] ?? 0;
    if (roll <= 0) {
      return { severity, tier: tier.key, tierLabel: tier.label, tagSlug: TURRET_SEVERITY_TAGS[severity] };
    }
  }
  // Only reachable on a column that sums under 1, which validate rejects.
  // Falling out the bottom as a graze is the harmless direction.
  return { severity: "graze", tier: tier.key, tierLabel: tier.label, tagSlug: null };
}

// Does the turret spare this character? The one question the whole gun asks.
// Compared case-insensitively on the trimmed presented name: the face is
// normally written from the Merchant's own character name at creation, but a
// GM can retype it by hand from the Dev Panel and a stray capital should not
// get somebody killed. An empty merchantFace spares nobody — a turret with no
// face on file is a turret that shoots the room, which is the safe failure for
// a gun that has to be deliberately armed in the first place.
function turretSpares(presentedName, depot) {
  const face = String(depot?.merchantFace ?? "").trim().toLowerCase();
  if (!face) return false;
  return String(presentedName ?? "").trim().toLowerCase() === face;
}

module.exports = {
  // Only what crosses a module boundary. The severity ladder, the armour
  // tiers, the shipped table and the per-column check are all internals of
  // this file; exporting them put four names on the @lifeweb/db barrel that
  // read as API and had no readers.
  turretTable,
  validateTurretTable,
  rollTurret,
  turretSpares,
};
