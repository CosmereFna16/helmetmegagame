// Whether a character's eyes are good enough to look somebody over right now.
//
// Two impairments, and both were pure fiction before this file existed:
// Spectacles has always promised to remove "the downside of Nearsighted", and
// neither slug appeared in a single line of code, so there was no downside to
// remove. Sun Sensitivity is new.
//
// This gates the **Look at** button on /character only. The 🔍 reaction in
// Discord stays open on purpose: that one needs the subject to have just
// spoken beside you, which is close enough to see whatever your eyes are.
//
// No Prisma import, same posture as inspectVision.js beside it — the sheet
// wants the answer to grey a button, and the server action wants it to refuse,
// and neither should be able to drift from the other.
const NEARSIGHTED_SLUG = "nearsighted";
const SPECTACLES_SLUG = "spectacles";
const SUN_SENSITIVITY_SLUG = "sun-sensitivity";

// Accepts the CharacterTag[] shape used everywhere else (`{ tag: { slug } }`),
// and tolerates a bare Tag[] as well. Same as inspectVision.js#slugSet.
function slugSet(characterTags) {
  return new Set((characterTags ?? []).map((ct) => ct?.tag?.slug ?? ct?.slug).filter(Boolean));
}

// Only EQUIPPED gear counts. A pair of spectacles at the bottom of a sack
// corrects nobody's vision, and `spectacles` is already `equippable: true` in
// the catalog, so CharacterTag.equipped is the honest test.
function equippedSet(characterTags) {
  return new Set(
    (characterTags ?? [])
      .filter((ct) => ct?.equipped === true)
      .map((ct) => ct?.tag?.slug ?? ct?.slug)
      .filter(Boolean),
  );
}

// Why this character cannot look anyone over, or null if they can.
//
// `where` carries the two facts outside the sheet that Sun Sensitivity needs:
// the open turn's phase and whether they are standing under a roof. Both
// default to the permissive side, so a caller that cannot resolve a turn or a
// Location never blinds somebody by accident.
function examineBlock(characterTags = [], where = {}) {
  const { phase = null, indoors = true } = where;
  const slugs = slugSet(characterTags);

  if (slugs.has(NEARSIGHTED_SLUG) && !equippedSet(characterTags).has(SPECTACLES_SLUG)) {
    return "Everything past arm's length is a blur. Put your spectacles on. ‡";
  }

  // Dawn outdoors only. The description promises the Caves and Dusk are fine,
  // so they are fine — the tag is a schedule to work around, not an off switch.
  if (slugs.has(SUN_SENSITIVITY_SLUG) && phase === "DAWN" && !indoors) {
    return "The daylight is too much to look into. Wait for Dusk, or get under a roof. ‡";
  }

  return null;
}

module.exports = { examineBlock, NEARSIGHTED_SLUG, SPECTACLES_SLUG, SUN_SENSITIVITY_SLUG };
