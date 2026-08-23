// Who is qualified to treat what, and — because of that — who can SEE what.
//
// Two things live here that used to live only in web/lib/healRequests.js. The
// skill-tier walk moved down because the bot needs it too now: 🔍-inspecting
// someone shows you the ailments YOU could treat as routine, even the ones
// nobody else can see. A doctor prodding a belly knows appendicitis; the man
// standing next to them sees a person having a bad day.
//
// Same posture as inspectVision.js: no Prisma import, required by subpath from
// both bot/ and web/, so the rule can't drift between the two faces of the
// game. web/lib/healRequests.js re-exports the two ancestry helpers so its own
// callers keep importing from where they always did.

// Tag.parentTagId is the replacing tier chain (Medical (Basic) -> (Skilled) ->
// (Expert)). Holding a higher tier has to satisfy a requirement written
// against a lower one, or a surgeon would be unable to do a nurse's job.
//
// `tags` is the flat catalog as [{ id, parentTagId }]; the result maps a tag id
// to itself plus every ancestor above it. Cycle-guarded, since nothing in the
// schema stops a chain from looping back on itself.
function buildSkillAncestry(tags) {
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
function satisfiedSkillIds(heldTagIds, ancestry) {
  const satisfied = new Set();
  for (const id of heldTagIds ?? []) {
    for (const ancestorId of ancestry.get(id) ?? [id]) satisfied.add(ancestorId);
  }
  return satisfied;
}

// The Health category's display name, as stored in Tag.category (syncTags
// writes the display name, not the YAML slug — the same casing trap the
// concealed-inspect filter used to sidestep by testing a group slug).
const HEALTH_CATEGORY = "Health";

// "Could this character treat that affliction without rolling for it?"
//
// Routine is the whole point of the word: a Gambit is by definition NOT
// routine, so a tier-7 affliction stays hidden even from an Expert who could
// attempt it. And a tag with no requirementSkills at all is not something
// anyone treats — the untreatable tier-0 ailments (Vomiting, a Migraine, a
// Concussion) are nobody's professional business.
//
// `tag` needs requirementSkills (at least { id }) and requirementGambit.
function canTreatAsRoutine(tag, satisfied) {
  const skills = tag?.requirementSkills ?? [];
  if (skills.length === 0 || tag.requirementGambit) return false;
  return skills.every((skill) => satisfied.has(skill.id));
}

// What an inspector sees of a subject's tags, and why.
//
// Returns the subject's CharacterTag rows that should be shown, each wrapped
// as { characterTag, viaSkill } — `viaSkill` true when the row is here ONLY
// because the inspector is qualified for it. Callers mark those differently:
// the patient isn't showing this to the room, so a medic shouldn't repeat it
// as though it were common knowledge.
//
// `characterTags` is the subject's rows as `{ tag: { ... } }`; `satisfied` is
// satisfiedSkillIds() for the INSPECTOR.
function medicallyVisibleTags(characterTags = [], satisfied = new Set()) {
  const out = [];
  for (const ct of characterTags) {
    const tag = ct?.tag;
    if (!tag) continue;
    if (tag.visibleOnInspect) {
      out.push({ characterTag: ct, viaSkill: false });
      continue;
    }
    // Only afflictions. A doctor's training says nothing about whether
    // somebody is secretly a Demoness.
    if (tag.category !== HEALTH_CATEGORY) continue;
    if (canTreatAsRoutine(tag, satisfied)) out.push({ characterTag: ct, viaSkill: true });
  }
  return out;
}

module.exports = {
  HEALTH_CATEGORY,
  buildSkillAncestry,
  satisfiedSkillIds,
  canTreatAsRoutine,
  medicallyVisibleTags,
};
