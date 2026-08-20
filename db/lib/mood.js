// Mood is not a column anywhere — it's two ordinary Status tags (Happy /
// Unhappy, mastered in docs/tags.yaml with durationTurns: 2), and "Neutral"
// is simply the absence of both. That choice means the existing per-turn
// expiry sweep in db/index.js#resolveNeeds already handles mood expiry, with
// no bespoke moodExpiresTurn column to keep in step.
//
// This module is the single source of the ±1 Gambit modifier, shared by the
// bot (bot/src/events/interactionCreate.js, where the d6 is rolled) and the
// web app (the Status panel readout), same posture as narrowcastAccess.js —
// so the number a player is shown and the number applied can't drift.

const MOOD_SLUGS = { HAPPY: "happy", UNHAPPY: "unhappy" };
const MOODS = ["NEUTRAL", "HAPPY", "UNHAPPY"];

const MOOD_LABELS = { NEUTRAL: "Neutral", HAPPY: "Happy", UNHAPPY: "Unhappy" };

// Only Gambits roll a die at all (see MoveKind), so this modifier only ever
// reaches a Gambit's roll — a Routine has nothing to apply it to.
const MOOD_MODIFIERS = { NEUTRAL: 0, HAPPY: 1, UNHAPPY: -1 };

// Accepts the CharacterTag[] shape used everywhere else in the app
// (`{ tag: { slug } }`), and tolerates a bare Tag[] as well.
function moodFromTags(characterTags = []) {
  const slugs = new Set(characterTags.map((ct) => ct?.tag?.slug ?? ct?.slug).filter(Boolean));
  if (slugs.has(MOOD_SLUGS.HAPPY)) return "HAPPY";
  if (slugs.has(MOOD_SLUGS.UNHAPPY)) return "UNHAPPY";
  return "NEUTRAL";
}

function moodModifier(mood) {
  return MOOD_MODIFIERS[mood] ?? 0;
}

function moodLabel(mood) {
  return MOOD_LABELS[mood] ?? "Neutral";
}

function moodTagSlug(mood) {
  return mood === "HAPPY" ? MOOD_SLUGS.HAPPY : mood === "UNHAPPY" ? MOOD_SLUGS.UNHAPPY : null;
}

// "+1" / "-1" / null — null meaning "don't render a modifier at all", which
// is different from rendering "+0".
function formatMoodModifier(mood) {
  const mod = moodModifier(mood);
  if (!mod) return null;
  return mod > 0 ? `+${mod}` : `${mod}`;
}

module.exports = {
  MOOD_SLUGS,
  MOODS,
  moodFromTags,
  moodModifier,
  moodLabel,
  moodTagSlug,
  formatMoodModifier,
};
