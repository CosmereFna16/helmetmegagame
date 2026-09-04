// What a medic can treat, and whether they're qualified to treat it.
//
// Deliberately pure — no Prisma, no server imports — because the client picker
// and the server action must agree: an affliction the dialog offers must be one
// healCharacterRequest will actually accept, and one it greys out must be one
// the action refuses. Same posture as consumeGrants.js.
//
// Tag.requirement* is documented in schema.prisma as covering "whichever
// direction is narratively relevant" — crafting reads it as the cost to gain a
// tag, healing as the cost to shed one. This module is the healing reading.

// The skill-tier walk lives in db/lib now, because the bot needs it too: the
// doctor's eye on 🔍-inspect asks the same "are you qualified for this?"
// question this module asks. Re-exported so every existing caller here keeps
// importing from where it always did.
export {
  buildSkillAncestry,
  satisfiedSkillIds,
  canTreatAsRoutine,
} from "@lifeweb/db/lib/medicalVision";

export const HEAL_SKILL_SLUG = "medical-basic";

// Health is its own category, split out of Status — Status is the
// needs/intoxication layer (Hungry, Drained, Tipsy) and afflictions are a
// system of their own. Tag.category stores the display name, not the YAML
// slug (see syncTags.js), which is why this is capitalised. Harm's menu still
// reads the category (isInflictable below); Heal's does not.
export const HEALABLE_CATEGORY = "Health";

// What Heal lists: the catalog's own `healable` flag (docs/tags.yaml), set on
// every affliction with a cure. A Health tag without it is tier 0 of the cure
// ladder (docs/systemdocs/TAGS.md §5c): something realistically untreatable
// that runs its own short course — Vomiting, a Migraine, a Concussion. It
// used to be derived from the category plus a requirement block; the flag
// replaced that so the menu is data, not a heuristic.
export function isHealable(tag) {
  return Boolean(tag?.healable);
}

// What one person can do to another with their hands. Harm used to offer the
// whole Health category — all 75 rows — which is how a player could stand over
// a Bound character and give them Exploded Chest ("a larva slithered out"),
// Appendicitis, or Hungover.
//
// The category is not a menu of attacks. Most of it is downstream of one:
// health-recovery is the aftermath a treatment leaves (Stitched Up, Splinted),
// health-infection is what the engine grants when a wound goes untended
// (Festering, Sepsis, Dying), health-illness is disease, and health-minor is
// mostly jokes. None of those is a thing you do to someone.
//
// Two groups are: health-wounds and health-maiming. Everything you can inflict
// by hand lives in one of them.
export const INFLICTABLE_GROUPS = new Set(["health-wounds", "health-maiming"]);

// Four out of health-mind that a beating plainly can cause, named one by one
// because the rest of that group (Amnesiac, Lunatic, Hallucinating, Night
// Blind, Stutter, Silence) cannot be. Paralyzed is deliberately absent: it is
// in INCAPACITATING_SLUGS, so inflicting it would let one player lock another
// out of their day's labor indefinitely, at will.
export const INFLICTABLE_SLUGS = new Set(["concussed", "shell-shocked", "blind", "mute"]);

// The picker and harmCharacterRequest both call this, for the reason this
// whole module is pure: an injury the dialog offers must be one the action
// accepts. `custom` keeps GM-authored tags out — the Harm menu is the catalog,
// not whatever a GM wrote for one scene.
export function isInflictable(tag) {
  if (!tag || tag.category !== HEALABLE_CATEGORY || tag.custom) return false;
  return INFLICTABLE_GROUPS.has(tag.group?.slug) || INFLICTABLE_SLUGS.has(tag.slug);
}

// null means free, not "unpriced" — the payer is still recorded either way.
export function healCost(tag) {
  return tag?.requirementResources ?? 0;
}

// The requirementSkills rows still missing — [] when qualified.
export function missingSkillsFor(tag, satisfied) {
  return (tag?.requirementSkills ?? []).filter((skill) => !satisfied.has(skill.id));
}

// Would treating this be a GAMBIT rather than a routine?
//
// Two ways it can be. Reaching above your tier is the obvious one — a nurse
// opening a belly — and the catalog's own `requirementGambit` is the other:
// the top rung of the cure ladder is a roll even for Esculap, which is what
// separates tier 7 from tier 6, since they share a price.
//
// Nothing is refused for being out of reach any more. A medic may ATTEMPT
// anything they can see; what changes is whether they roll for it, and a
// failed roll can leave the patient worse (docs/systemdocs/TAGS.md §5c).
export function isGambitHeal(tag, satisfied) {
  if (!tag) return false;
  return Boolean(tag.requirementGambit) || missingSkillsFor(tag, satisfied).length > 0;
}

// A 0-turn cure is a free action and never counts against the per-turn
// allowance. See MEDICAL_TIER_CAPS in web/lib/requests.js.
export function countsAgainstHealCap(tag) {
  return (tag?.requirementTurns ?? 0) > 0;
}

// The medic's own allowance: the cap of the HIGHEST medical tier they hold.
// Tiers replace each other up Tag.parentTagId, so an Expert is not also
// spending a Basic's two — they simply get four.
//
// `heldSlugs` is a Set of the character's tag slugs; `caps` is
// MEDICAL_TIER_CAPS, passed in so this module stays free of that import and
// the client and the server cannot disagree about the numbers.
export function healCapFor(heldSlugs, caps) {
  const ladder = ["medical-expert", "medical-skilled", "medical-basic"];
  for (const slug of ladder) if (heldSlugs.has(slug)) return caps[slug] ?? 0;
  return 0;
}
