// The Lifeweb's blood pool: GameConfig.lifewebBlood, 0-100. Two things feed
// it — a Donate Blood (the donor lives, and takes the Drained tag) and a Feed
// Person (someone is fed to it whole).
//
// This module is the single source of both numbers, shared by the GM panel
// (web/app/(app)/lifeweb/actions.js) and the player-facing Requests
// (web/app/(app)/lifeweb/requestActions.js), same posture as mood.js — so the
// amount a player is shown and the amount applied cannot drift.

const { NOBILITY_SLUG, COURTIER_SLUG } = require("./constants");

const BLOOD_MAX = 100;
const FEED_PERSON_AMOUNT = 100;

// Whose blood it is decides what it's worth: noble blood is richer than a
// courtier's, and a courtier's richer than a commoner's. Keyed on the tags of
// the character being bled, not the Mortus doing the bleeding.
const DONATE_BLOOD_BASE = 20;
const DONATE_BLOOD_BY_TAG = [
  { slug: NOBILITY_SLUG, amount: 40, label: "Nobility" },
  { slug: COURTIER_SLUG, amount: 30, label: "Courtier" },
];

// Accepts the CharacterTag[] shape used everywhere else (`{ tag: { slug } }`)
// and tolerates a bare Tag[], same as moodFromTags. Highest tier wins, so
// holding both Nobility and Courtier is worth 40 rather than 30.
function bloodValueForTags(characterTags = []) {
  const slugs = new Set(characterTags.map((ct) => ct?.tag?.slug ?? ct?.slug).filter(Boolean));
  for (const tier of DONATE_BLOOD_BY_TAG) {
    if (slugs.has(tier.slug)) return { amount: tier.amount, tier: tier.label };
  }
  return { amount: DONATE_BLOOD_BASE, tier: null };
}

// Returns the delta that was ACTUALLY applied, not the amount asked for. The
// pool caps at 100, so donating 40 onto a pool at 90 moves 10 — and an Undo
// that reversed the nominal 40 would mint 30 blood out of nothing. Callers
// snapshot `delta` onto Request.effect and Undo reads only that, which is the
// payload-vs-effect rule in REQUESTS.md §2 applied to the blood pool.
function applyBlood(current, amount) {
  const before = Math.max(0, Math.min(BLOOD_MAX, current ?? 0));
  const after = Math.max(0, Math.min(BLOOD_MAX, before + amount));
  return { before, after, delta: after - before };
}

module.exports = {
  BLOOD_MAX,
  FEED_PERSON_AMOUNT,
  DONATE_BLOOD_BASE,
  DONATE_BLOOD_BY_TAG,
  bloodValueForTags,
  applyBlood,
};
