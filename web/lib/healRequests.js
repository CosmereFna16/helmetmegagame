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

// null means free, not "unpriced" — the payer is still recorded either way.
export function healCost(tag) {
  return tag?.requirementResources ?? 0;
}

// The requirementSkills rows still missing — [] when qualified.
export function missingSkillsFor(tag, satisfied) {
  return (tag?.requirementSkills ?? []).filter((skill) => !satisfied.has(skill.id));
}
