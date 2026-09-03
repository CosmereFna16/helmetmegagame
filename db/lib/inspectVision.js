// What 🔍-inspecting another character shows you beyond their appearance.
//
// Seductive (the Demoness tag, docs/tags.yaml's hidden `demoness` category) is
// the one tag that buys automatic, free read access to another sheet's last
// fulfilled Desire. Empathetic and Mindreading read the same fact only via a
// GM-adjudicated Gambit. Inscrutable is the counter, read off the subject.
//
// No Prisma import; imported by subpath from both bot/ and web/ so the rule
// can't drift between the two faces of the game.
const { SEDUCTIVE_DEMONESS_SLUG, INSCRUTABLE_SLUG } = require("./constants");

// A list, not a bare slug, so another tag can be added without touching the
// check below.
const DESIRE_SIGHT_SLUGS = [SEDUCTIVE_DEMONESS_SLUG];

// Accepts the CharacterTag[] shape used everywhere else in the app
// (`{ tag: { slug } }`), and tolerates a bare Tag[] as well.
function slugSet(characterTags) {
  return new Set((characterTags ?? []).map((ct) => ct?.tag?.slug ?? ct?.slug).filter(Boolean));
}

// Read off the VIEWER: what they can see when they inspect anyone.
function inspectVision(characterTags = []) {
  const slugs = slugSet(characterTags);
  return {
    canSeeDesire: DESIRE_SIGHT_SLUGS.some((slug) => slugs.has(slug)),
  };
}

// Read off the SUBJECT: whether their Desire is closed to every reader.
//
// Separate from inspectVision() because the caller resolves the viewer before
// it knows who's being looked at. Present this as "no Desire to read", not a
// blocked field — a "hidden" placeholder would advertise what Inscrutable hides.
function isInscrutable(characterTags = []) {
  return slugSet(characterTags).has(INSCRUTABLE_SLUG);
}

module.exports = { inspectVision, isInscrutable };
