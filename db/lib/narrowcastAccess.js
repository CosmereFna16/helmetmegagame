// Shared access rules for the two hardcoded narrowcast channels (#radio,
// #intercom). Unlike a Location, these aren't gated by "is the character
// standing here" alone — each has its own bespoke Zone/Location/tag
// condition — so instead of a generic tag-gate table this is just a rules
// object keyed by channel slug, called by both
// bot/src/lib/location.js#syncCharacterNarrowcastAccess (gateway) and
// web/lib/discordGuild.js#syncCharacterNarrowcastAccess (REST). Both grant
// access the same way Locations do: a permission overwrite on the
// character's own personal Discord role, added/removed as their tags or
// location change — never a separate gate role.
const { DEPTHS_SLUGS } = require("./travelCost");

const NARROWCAST_SLUGS = ["radio", "intercom"];

const NARROWCAST_RULES = {
  // Anyone holding the Radio tag can hear and speak on it, unless they're
  // currently in the Depths — all three levels of it are dead air, not just
  // the deepest.
  radio: (ctx) => {
    if (!ctx.tagSlugs.has("radio")) return null;
    if (DEPTHS_SLUGS.has(ctx.locationSlug)) return null;
    return { view: true, send: true };
  },
  // Audible anywhere in Fortress or Town; only speakable by an
  // Intercom-tagged character actually standing in the Keep.
  intercom: (ctx) => {
    const inRange = ctx.zoneName === "Fortress" || ctx.zoneName === "Town";
    const canSpeak = ctx.tagSlugs.has("intercom") && ctx.locationSlug === "keep";
    if (!inRange && !canSpeak) return null;
    return { view: inRange || canSpeak, send: canSpeak };
  },
};

// Loads the current Location/Zone and held tags for one character — the
// only inputs the rules table above needs. Location/Zone are read by slug/
// name (not id) since the rules are authored against docs/locations.yaml's
// fixed identifiers.
async function buildNarrowcastContext(prisma, characterId) {
  const [character, tags] = await Promise.all([
    prisma.character.findUnique({
      where: { id: characterId },
      select: { location: { select: { slug: true } }, zone: { select: { name: true } } },
    }),
    prisma.characterTag.findMany({
      where: { characterId },
      select: { tag: { select: { slug: true } } },
    }),
  ]);

  return {
    locationSlug: character?.location?.slug ?? null,
    zoneName: character?.zone?.name ?? null,
    tagSlugs: new Set(tags.map((t) => t.tag.slug)),
  };
}

// Returns { radio: {view,send}|null, intercom: {view,send}|null } — null
// means the character gets no overwrite on that channel (falls back to the
// channel's @everyone deny).
function computeNarrowcastAccess(ctx) {
  return Object.fromEntries(NARROWCAST_SLUGS.map((slug) => [slug, NARROWCAST_RULES[slug](ctx)]));
}

module.exports = { NARROWCAST_SLUGS, buildNarrowcastContext, computeNarrowcastAccess };
