// The single source of the summed Gambit die modifier. Hunger is the only
// contributor: -1 * min(hungerStreak, cap).
//
// It stays a list-returning module rather than collapsing to one number,
// because Action.diceModifier is one Int and the confirm DM still wants the
// contribution NAMED ("−2 Hungry"). Keeping the shape also means a second
// contributor is an append here rather than a rewrite of five call sites —
// which is what happened when Mood was removed and this went from two
// contributors to one.
//
// No prisma import, so both bot/ and web/ import it by subpath.
const { HUNGER_SLUG } = require("./constants");
const { HUNGER_STREAK_CAP } = require("./hungerPass");

const HUNGER_LABEL = "Hungry";

// Accepts the CharacterTag[] shape used everywhere else in the app
// (`{ tag: { slug } }`), and tolerates a bare Tag[].
function hasHunger(characterTags = []) {
  return characterTags.some((ct) => (ct?.tag?.slug ?? ct?.slug) === HUNGER_SLUG);
}

// The escalating half of the Hunger penalty: -1 per consecutive hungry turn
// (Character.hungerStreak, written by hungerPass.js), floored at
// -HUNGER_STREAK_CAP — the same cap that grants `dying`. A character with no
// streak recorded (hungerStreak 0, or the field missing on an older read)
// still gets -1 as long as they hold the tag, so this can't regress to 0
// for anyone who has gone hungry at least once.
function hungerModifier(hungerStreak = 0) {
  return -Math.min(Math.max(hungerStreak, 1), HUNGER_STREAK_CAP);
}

// [{ label, value }] — omitting anything worth 0. This is the breakdown the
// confirm DM renders; gambitModifierTotal() is the number that goes in the
// column.
//
// `hungerStreak` is a second argument, not read off characterTags, because it
// lives on Character rather than on the tag: see the comment on
// Character.hungerStreak in schema.prisma.
function gambitModifiers(characterTags = [], { hungerStreak = 0 } = {}) {
  const out = [];

  if (hasHunger(characterTags)) out.push({ label: HUNGER_LABEL, value: hungerModifier(hungerStreak) });

  return out;
}

function gambitModifierTotal(characterTags = [], opts = {}) {
  return gambitModifiers(characterTags, opts).reduce((sum, m) => sum + m.value, 0);
}

// "−1 Hungry" — U+2212 minus, matching the bot's roll line. Takes the
// array so a caller that already computed it doesn't recompute.
function formatGambitModifiers(modifiers = []) {
  return modifiers.map((m) => `${m.value > 0 ? "+" : "−"}${Math.abs(m.value)} ${m.label}`).join(" ");
}

module.exports = {
  gambitModifiers,
  gambitModifierTotal,
  formatGambitModifiers,
};
