// What 🔍-inspecting another character shows you beyond their appearance.
//
// Seductive — the Demoness tag (docs/tags.yaml's hidden `demoness` category) —
// is the ONE tag that buys real read access to someone else's sheet: the last
// Desire they fulfilled, free and silent.
//
// Two tags that used to sit beside it no longer do, and the reason is the same
// for both. Empathetic (slug `seductive`, an old name kept as the stable key)
// and Mindreading (the Succubus Draught's grant) now read the same fact with a
// Gambit, after a conversation — that is the GM's to adjudicate, not this
// file's, and a free field on the embed would hand over what the roll is for.
// Being an automatic read is what the Demoness is paying its extra point for.
//
// Inscrutable is the counter, and it is the one rule here read off the
// SUBJECT instead of the viewer.
//
// Same posture as gambitModifier.js: no Prisma import, imported by subpath from both
// bot/ and web/, so the rule can't drift between the two faces of the game.
// Today the only caller is the bot's inspect handler
// (bot/src/events/messageReactionAdd.js) — the web has no other-player
// character sheet to put this on.
const { SEDUCTIVE_DEMONESS_SLUG, INSCRUTABLE_SLUG, RAGE_SLUG } = require("./constants");

// Still a list, not a bare slug: it has held three entries and now holds one,
// and the shape is what lets a tag be added back without touching the check.
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
    // Rite: Rage (docs/tags.yaml): "you can no longer examine people." Blinds
    // the REACTOR's own inspect — nothing about who they're looking at.
    ragingBlind: slugs.has(RAGE_SLUG),
  };
}

// Read off the SUBJECT: whether their Desire is closed to every reader.
//
// A separate function rather than a second argument to inspectVision(),
// because the caller resolves the viewer before it knows who is being looked
// at — the Rage check above has to fire before the subject is even loaded.
//
// Callers should present this as "no Desire to read" rather than as a blocked
// field. Inscrutable is not `visible`, and a "hidden" placeholder would
// advertise the very thing the tag buys.
function isInscrutable(characterTags = []) {
  return slugSet(characterTags).has(INSCRUTABLE_SLUG);
}

module.exports = { inspectVision, isInscrutable };
