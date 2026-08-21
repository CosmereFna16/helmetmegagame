// The single source of the summed Gambit die modifier. Mood (db/lib/mood.js)
// contributes ±1 and Hunger contributes -1, and they stack additively:
// Unhappy + Hungry = -2, Happy + Hungry = 0.
//
// Action.diceModifier is one Int, so the SUM is what gets stored — this module
// is what keeps the number the player is shown, the number written to the row,
// and the named breakdown in the confirm DM from ever drifting apart.
//
// Deliberately a thin composer OVER mood.js rather than a generalization of
// it: Mood is a tri-state with a player-facing write path (moodTagSlug,
// moodLabel, the countdown on StatusPanel), Hunger is a boolean the turn
// engine grants. Folding them together would make mood.js the home of a
// concept it doesn't own. Same posture as mood.js itself — no prisma import,
// so both bot/ and web/ import it by subpath.
const { moodFromTags, moodModifier, moodLabel } = require("./mood");
const { HUNGER_SLUG } = require("./constants");

const HUNGER_MODIFIER = -1;
const HUNGER_LABEL = "Hungry";

// Accepts the CharacterTag[] shape used everywhere else in the app
// (`{ tag: { slug } }`), and tolerates a bare Tag[] — same as moodFromTags.
function hasHunger(characterTags = []) {
  return characterTags.some((ct) => (ct?.tag?.slug ?? ct?.slug) === HUNGER_SLUG);
}

// [{ label, value }] in display order — mood first, then hunger — omitting
// anything worth 0 (Neutral). This is the breakdown the confirm DM renders;
// gambitModifierTotal() is the number that goes in the column.
function gambitModifiers(characterTags = []) {
  const out = [];

  const mood = moodFromTags(characterTags);
  if (moodModifier(mood)) out.push({ label: moodLabel(mood), value: moodModifier(mood) });

  if (hasHunger(characterTags)) out.push({ label: HUNGER_LABEL, value: HUNGER_MODIFIER });

  return out;
}

function gambitModifierTotal(characterTags = []) {
  return gambitModifiers(characterTags).reduce((sum, m) => sum + m.value, 0);
}

// "+1 Happy −1 Hungry" — U+2212 minus, matching the bot's roll line. Takes the
// array so a caller that already computed it doesn't recompute.
function formatGambitModifiers(modifiers = []) {
  return modifiers.map((m) => `${m.value > 0 ? "+" : "−"}${Math.abs(m.value)} ${m.label}`).join(" ");
}

module.exports = {
  HUNGER_MODIFIER,
  HUNGER_LABEL,
  hasHunger,
  gambitModifiers,
  gambitModifierTotal,
  formatGambitModifiers,
};
