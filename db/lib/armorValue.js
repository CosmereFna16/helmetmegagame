// Armour, as the game shows it and as the guns roll against it.
//
// Two numbers live on every piece of gear (Tag.meleeArmor, Tag.ballisticArmor,
// both 0.0-1.0). This file owns the three things that must not drift apart:
// the word a number is shown as, how several worn pieces combine, and nothing
// else. The severity ladder and the odds stay in db/lib/depotTurret.js — that
// file is the ballistics, this one is the armour.
//
// It replaced a hardcoded priority list of seven body-armour slugs. That list
// knew about plate and mail and did not know about a single helmet, shield,
// buckler, pavise or the spacesuit, so a character in a closed steel helm rolled
// on the bare no-armour column. A number on the tag cannot go stale the way a
// list in a file did the moment somebody added a helmet to the catalog.
//
// Pure and Prisma-free, so both faces and the sync can use it.

// Words, never numbers — the same posture db/lib/laborYield.js#qualityWord
// takes for Laboring. A player is told a helmet is Sufficient against bullets;
// working out that Sufficient is 0.35 and Good is 0.5 is their job, and it
// keeps kit choice a judgement rather than a spreadsheet.
//
// Six steps over 0..1, evenly cut. "None" covers absent as well as zero: a
// skill has no armour value and neither does a sack over the head, and there is
// no useful difference between those two for a player reading a chip.
const ARMOR_WORDS = [
  { below: 0.001, word: "None" },
  { below: 0.2, word: "Meager" },
  { below: 0.4, word: "Sufficient" },
  { below: 0.6, word: "Good" },
  { below: 0.8, word: "Strong" },
  { below: Infinity, word: "Overkill" },
];

// The one place an armour value becomes a word.
function armorWord(value) {
  if (typeof value !== "number" || Number.isNaN(value) || value <= 0) return "None";
  return ARMOR_WORDS.find((step) => value < step.below).word;
}

// Nothing is ever bulletproof. The cap is here rather than in the roll so that
// every future reader of a combined value gets it, and so a GM who authors a
// 1.0 gets "very good" rather than "immune" — which is a much better failure
// than a character nobody can touch.
const ARMOR_CAP = 0.95;

// How worn pieces stack. Multiplicative on what gets THROUGH, not additive on
// what is stopped: a helmet that turns 40% and a breastplate that turns 25%
// leave 0.6 * 0.75 = 45% coming through, so together they are 0.55. That gives
// a full kit a real reward while making the second and third piece each worth
// less than the first, which is both how armour actually works and what stops
// a character in six overlapping layers from being untouchable.
//
// `field` picks which of the two numbers to read, so melee gets this for free
// the day something rolls against it.
function combineArmor(characterTags = [], field = "ballisticArmor") {
  let through = 1;
  for (const entry of characterTags) {
    // Armour only counts EQUIPPED. A vest in your cart stops nothing, and
    // letting it would make a turret survivable by shopping. A bare Tag[] has
    // no equipped flag, so `!== false` keeps those callers working the way the
    // rest of the codebase treats that shape.
    if (entry?.equipped === false) continue;
    const tag = entry?.tag ?? entry;
    const value = tag?.[field];
    if (typeof value !== "number" || Number.isNaN(value) || value <= 0) continue;
    through *= 1 - Math.min(1, value);
  }
  return Math.min(ARMOR_CAP, 1 - through);
}

// The Tag columns anything resolving armour must select. Same discipline as
// CONCEALMENT_TAG_FIELDS: miss one and armour silently stops working at that
// surface only.
const ARMOR_TAG_FIELDS = { meleeArmor: true, ballisticArmor: true };

module.exports = { ARMOR_CAP, ARMOR_TAG_FIELDS, armorWord, combineArmor };
