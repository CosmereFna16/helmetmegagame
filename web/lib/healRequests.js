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

// Health is its own category now, split out of Status — Status is the
// needs/intoxication layer (Hungry, Drained, Tipsy) and afflictions are a system of
// their own. Tag.category stores the display name, not the YAML slug (see
// syncTags.js), which is why this is capitalised.
export const HEALABLE_CATEGORY = "Health";

// A Health tag with no requirement block at all is tier 0 of the cure ladder
// (docs/systemdocs/TAGS.md §5c): something realistically untreatable that runs
// its own short course — Vomiting, a Migraine, a Concussion. Priced ones are
// the afflictions a doctor actually does something about.
export function hasCureCost(tag) {
  if (!tag) return false;
  return Boolean(
    tag.requirementTurns ||
      tag.requirementResources ||
      tag.requirementGambit ||
      tag.requirementSkills?.length,
  );
}

export function isHealable(tag) {
  return Boolean(tag) && tag.category === HEALABLE_CATEGORY && hasCureCost(tag);
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
// out of their Default Move indefinitely, at will.
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
