// What 🔍-inspecting another character shows you beyond their appearance.
//
// Seductive buys real read access to someone else's sheet: their active
// Desire. It has a discounted Demoness twin (docs/tags.yaml's hidden
// `demoness` category) that grants exactly the same sight, so both slugs
// count. Mindreading (the Succubus Draught's grant) is a third tag that
// grants the same sight.
//
// Same posture as mood.js: no Prisma import, imported by subpath from both
// bot/ and web/, so the rule can't drift between the two faces of the game.
// Today the only caller is the bot's inspect handler
// (bot/src/events/messageReactionAdd.js) — the web has no other-player
// character sheet to put this on.
const { SEDUCTIVE_SLUG, SEDUCTIVE_DEMONESS_SLUG, MINDREADING_SLUG } = require("./constants");

const DESIRE_SIGHT_SLUGS = [SEDUCTIVE_SLUG, SEDUCTIVE_DEMONESS_SLUG, MINDREADING_SLUG];

// Accepts the CharacterTag[] shape used everywhere else in the app
// (`{ tag: { slug } }`), and tolerates a bare Tag[] as well.
function inspectVision(characterTags = []) {
  const slugs = new Set(characterTags.map((ct) => ct?.tag?.slug ?? ct?.slug).filter(Boolean));
  return {
    canSeeDesire: DESIRE_SIGHT_SLUGS.some((slug) => slugs.has(slug)),
  };
}

module.exports = { DESIRE_SIGHT_SLUGS, inspectVision };
