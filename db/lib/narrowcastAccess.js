// Shared access rules for the two hardcoded narrowcast channels (#watch,
// #intercom). Unlike a Location, these aren't gated by "is the character
// standing here" alone — each has its own bespoke Zone/Location/tag
// condition — so instead of a generic tag-gate table this is just a rules
// object keyed by channel slug, called by both
// bot/src/lib/location.js#syncCharacterNarrowcastAccess (gateway) and
// web/lib/discordGuild.js#syncCharacterNarrowcastAccess (REST). Both grant
// access the same way Locations do: a permission overwrite on the
// character's own personal Discord role, added/removed as their tags or
// location change — never a separate gate role.

const NARROWCAST_SLUGS = ["watch", "intercom"];

const NARROWCAST_RULES = {
  // The Watch's radio net. Radio Bracelet receives; the Captain's Radio
  // System also sends. Possession is what matters — a bracelet transferred
  // to a non-Watch character still opens the channel.
  watch: (ctx) => {
    if (ctx.tagSlugs.has("radio-system")) return { view: true, send: true };
    if (ctx.tagSlugs.has("radio-bracelet")) return { view: true, send: false };
    return null;
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

// Returns { watch: {view,send}|null, intercom: {view,send}|null } — null
// means the character gets no overwrite on that channel (falls back to the
// channel's @everyone deny).
function computeNarrowcastAccess(ctx) {
  return Object.fromEntries(NARROWCAST_SLUGS.map((slug) => [slug, NARROWCAST_RULES[slug](ctx)]));
}

module.exports = { NARROWCAST_SLUGS, buildNarrowcastContext, computeNarrowcastAccess };
