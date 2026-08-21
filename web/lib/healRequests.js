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

export const HEAL_SKILL_SLUG = "medical-basic";

// Tag.category stores the display name, not the YAML slug (see syncTags.js).
export const HEALABLE_CATEGORY = "Status";

// A Status tag with no requirement block at all is a plain condition that runs
// its own course — Hungry, Drained, Unhappy — not something a doctor removes.
// Priced ones (Arthritis) are the afflictions.
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

// Tag.parentTagId is the replacing tier chain (Medical (Basic) -> (Skilled) ->
// (Excellent)). Holding a higher tier has to satisfy a requirement written
// against a lower one, or a surgeon would be unable to do a nurse's job.
//
// `tags` is the flat catalog as [{ id, parentTagId }]; the result maps a tag id
// to itself plus every ancestor above it. Cycle-guarded, since nothing in the
// schema stops a chain from looping back on itself.
export function buildSkillAncestry(tags) {
  const parentOf = new Map((tags ?? []).map((t) => [t.id, t.parentTagId ?? null]));
  const ancestry = new Map();
  for (const id of parentOf.keys()) {
    const seen = new Set();
    let cursor = id;
    while (cursor && !seen.has(cursor)) {
      seen.add(cursor);
      cursor = parentOf.get(cursor) ?? null;
    }
    ancestry.set(id, seen);
  }
  return ancestry;
}

// Every skill the character counts as having: what they hold, plus everything
// those tags are an upgrade of.
export function satisfiedSkillIds(heldTagIds, ancestry) {
  const satisfied = new Set();
  for (const id of heldTagIds ?? []) {
    for (const ancestorId of ancestry.get(id) ?? [id]) satisfied.add(ancestorId);
  }
  return satisfied;
}

// The requirementSkills rows still missing — [] when qualified.
export function missingSkillsFor(tag, satisfied) {
  return (tag?.requirementSkills ?? []).filter((skill) => !satisfied.has(skill.id));
}
