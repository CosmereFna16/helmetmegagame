// What 🔍-inspecting another character shows you beyond their appearance.
//
// Two tags buy real read access to someone else's sheet: Seductive reveals
// their active Desire, Torturer their Fear. Each has a discounted
// Demoness twin (docs/tags.yaml's hidden `demoness` category) that grants
// exactly the same sight, so both slugs of a pair count.
//
// Same posture as mood.js: no Prisma import, imported by subpath from both
// bot/ and web/, so the rule can't drift between the two faces of the game.
// Today the only caller is the bot's inspect handler
// (bot/src/events/messageReactionAdd.js) — the web has no other-player
// character sheet to put this on.
const {
  SEDUCTIVE_SLUG,
  SEDUCTIVE_DEMONESS_SLUG,
  TORTURER_SLUG,
  TORTURER_DEMONESS_SLUG,
} = require("./constants");

const DESIRE_SIGHT_SLUGS = [SEDUCTIVE_SLUG, SEDUCTIVE_DEMONESS_SLUG];
const FEAR_SIGHT_SLUGS = [TORTURER_SLUG, TORTURER_DEMONESS_SLUG];

// Accepts the CharacterTag[] shape used everywhere else in the app
// (`{ tag: { slug } }`), and tolerates a bare Tag[] as well.
function inspectVision(characterTags = []) {
  const slugs = new Set(characterTags.map((ct) => ct?.tag?.slug ?? ct?.slug).filter(Boolean));
  return {
    canSeeDesire: DESIRE_SIGHT_SLUGS.some((slug) => slugs.has(slug)),
    canSeeFear: FEAR_SIGHT_SLUGS.some((slug) => slugs.has(slug)),
  };
}

module.exports = { DESIRE_SIGHT_SLUGS, FEAR_SIGHT_SLUGS, inspectVision };
