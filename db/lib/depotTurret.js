// The turret's ballistics: what a burst does to a sheet. db/lib/turretPass.js
// is the trigger, this is the damage.
//
// Nothing else in this codebase rolls damage. Injuries are otherwise
// GM-adjudicated (HARM_CHARACTER) or a narrative Gambit outcome, so this is
// still the only automated harm mechanic in Bascinet.
//
// Two things about it are deliberate and easy to get wrong.
//
// It reads FACES, not papers. The turret spares exactly one thing: a character
// whose PRESENTED name matches Depot.merchantFace. Not the licence, not the
// keycard, not the role. So a concealed Merchant is shot by his own gun, a
// Docker who steals the card is still shot, and anyone who comes back wearing
// the Merchant's name walks past it. That trap is the point of the feature.
//
// And armour bends a CURVE rather than picking a column. This used to be seven
// hand-written probability columns selected by a hardcoded list of body-armour
// slugs, which meant every helmet, shield, buckler, pavise and the spacesuit
// counted for exactly nothing — somebody in a closed steel helm rolled on the
// bare column. Armour is now Tag.ballisticArmor, a number on the gear itself
// (db/lib/armorValue.js), so a new piece protects the moment it is authored and
// no second list can fall behind the catalog.

const { combineArmor } = require("./armorValue");

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

// What a burst does to somebody wearing nothing. Roughly: a fifth walk away, two
// fifths are badly hurt, two fifths are dying or dead. Standing in front of an
// armed machinegun in shirtsleeves should not be a coin flip on being fine, and
// for a while it was — the old bare column gave a 35% chance of a graze or a
// minor wound.
//
// Sums to 1, and validateTurretTable enforces that on the write path.
const DEFAULT_TURRET_TABLE = {
  graze: 0.06,
  "minor-wound": 0.14,
  "deep-wound": 0.16,
  "grievous-wound": 0.24,
  dying: 0.22,
  dead: 0.18,
};

// Floating point will not give you exactly 1.0 from six decimals, so the
// assertion has to have a tolerance. Same posture as cavingLoot's column sums.
const SUM_EPSILON = 0.0001;

// How hard armour bends the curve. The roll is a uniform draw raised to the
// power (1 + ARMOR_GAIN * protection): at zero protection the exponent is 1 and
// the draw is exactly the table above, and every step of armour pushes the
// distribution toward the mild end WITHOUT ever closing the top of it.
//
// That last property is why this is an exponent and not a subtraction or a
// scaling. Both of those hit a point where death becomes literally impossible,
// and "there exists a jacket that makes a machinegun safe" is a worse rule than
// any number could fix. Here the best kit in the game still buries about one
// wearer in twenty.
//
// At 3, roughly: nothing -> 18% dead, plate and a helm -> 9%, light infantry
// armour -> 6%, an energy shield -> 5%. Turn it up to make armour matter more.
const ARMOR_GAIN = 3;

// A GM's stored weights over the shipped ones, taken WHOLE rather than merged
// key-by-key: a half-overridden table would silently stop summing to 1.
function turretTable(depot) {
  const stored = depot?.turretTable;
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) return DEFAULT_TURRET_TABLE;
  // Belt and braces against a table written by something other than the
  // validated Dev Panel form — a hand-edited row, a restored backup from
  // before a severity was renamed. A table that cannot be rolled against falls
  // back to the shipped one rather than quietly skewing every shot.
  let sum = 0;
  for (const [key, weight] of Object.entries(stored)) {
    if (!TURRET_SEVERITIES.includes(key)) return DEFAULT_TURRET_TABLE;
    if (typeof weight !== "number" || Number.isNaN(weight) || weight < 0) return DEFAULT_TURRET_TABLE;
    sum += weight;
  }
  if (Math.abs(sum - 1) > SUM_EPSILON) return DEFAULT_TURRET_TABLE;
  return stored;
}

// Throws on a table that cannot be rolled against.
//
// The write path is where this runs: web/app/(app)/gm/dev/actions.js#updateDepot
// refuses a save whose weights do not sum to 1, so a mistuned table never
// reaches the database in the first place. That is deliberately stricter than
// validating at startup — by then the bad odds are already live, and a GM
// staring at a rejected form is told exactly what is wrong while they still
// have it in front of them.
function validateTurretTable(table = DEFAULT_TURRET_TABLE) {
  if (!table || typeof table !== "object" || Array.isArray(table)) {
    throw new Error("Turret table: not a mapping of severity to weight");
  }
  for (const key of Object.keys(table)) {
    if (!TURRET_SEVERITIES.includes(key)) {
      throw new Error(`Turret table: unknown severity "${key}"`);
    }
  }
  let sum = 0;
  for (const severity of TURRET_SEVERITIES) {
    const w = table[severity];
    if (w === undefined) continue;
    if (typeof w !== "number" || Number.isNaN(w) || w < 0) {
      throw new Error(`Turret table: bad weight for "${severity}"`);
    }
    sum += w;
  }
  if (Math.abs(sum - 1) > SUM_EPSILON) {
    throw new Error(`Turret table: weights sum to ${sum}, not 1`);
  }
  return true;
}

// One shot. `rng` is injectable so a test can pin the outcome; nothing in
// production passes it.
//
// The draw is bent, then walked down the cumulative ladder — so the table stays
// readable as "what happens to somebody wearing nothing" no matter how much
// armour is involved, and there is exactly one place to retune lethality.
function rollTurret(characterTags, depot, rng = Math.random) {
  const protection = combineArmor(characterTags, "ballisticArmor");
  const table = turretTable(depot);
  const bent = Math.pow(rng(), 1 + ARMOR_GAIN * protection);

  let roll = bent;
  for (const severity of TURRET_SEVERITIES) {
    roll -= table[severity] ?? 0;
    if (roll <= 0) {
      return { severity, protection, tagSlug: TURRET_SEVERITY_TAGS[severity] };
    }
  }
  // Only reachable on a table that sums under 1, which validate rejects.
  // Falling out the bottom as a graze is the harmless direction.
  return { severity: "graze", protection, tagSlug: null };
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
  // Only what crosses a module boundary. The severity ladder, the shipped
  // table and the gain constant are all internals of this file; exporting them
  // put names on the @lifeweb/db barrel that read as API and had no readers.
  turretTable,
  validateTurretTable,
  rollTurret,
  turretSpares,
};
