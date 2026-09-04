// The one faction the game treats as "no faction at all", plus the rule that
// keeps it findable.
//
// Every branch used to compare `faction.name === "Unaffiliated"`, in eleven
// places across web and bot. That name is player-editable now — a Leader
// renames their own faction, and a GM renames any of them from /gm/dev — so a
// single rename would silently have broken empty-faction handling, delete
// protection and the same-faction visibility gate all at once. Match on the
// slug, which nothing can change once the row exists.
//
// Same posture as db/lib/roleIds.js: this is a fixed identifier, not a secret
// and not per-environment, so it lives in code rather than in an env var.

const UNAFFILIATED_SLUG = "unaffiliated";

// True for the standing "nobody" faction, and for having no faction at all —
// the two are the same thing everywhere in the game, which is exactly why
// callers kept writing the test out by hand.
function isUnaffiliated(faction) {
  if (!faction) return true;
  return faction.slug === UNAFFILIATED_SLUG;
}

// The inverse, for the visibility gates that ask "are these two people in a
// real faction together?" — see db/lib/examine.js and FACTIONS.md §4a.
function inRealFaction(subject) {
  return Boolean(subject?.factionId) && !isUnaffiliated(subject.faction);
}

module.exports = { UNAFFILIATED_SLUG, isUnaffiliated, inRealFaction };
