// The registry of SPECIAL CHANNELS — standing channels outside the zone
// system. Each entry fully describes a channel: provisioning, static role
// grants, per-character access, wipe behavior, ghost visibility and tupper
// routing all derive from it. Adding a channel is one entry here plus one
// GameConfig id column.
//
// Access rules stay CODE: they're real logic over tags and zones, not data a
// YAML mini-language could express cleanly.
//
// #watch is the only entry left. #intercom used to be the second: a standing
// channel a tag-holder typed into, viewable by every above-ground zone role.
// It is now a button on the table in the Council Room (db/lib/intercom.js),
// which broadcasts into each zone's own #summary — so the PA is a thing in a
// room again rather than a place you travel to. Its GameConfig column stays
// as an orphan, the way mindlinkChannelId did.

const SPECIAL_CHANNELS = [
  {
    slug: "watch",
    configKey: "watchChannelId",
    categoryConfigKey: "radioCategoryId",
    topic: "The Watch's radio net. Bracelets receive; the Captain's system speaks.",
    tupper: true,
    wipe: "clear",
    ghostsMaySee: true,
    roleViewZones: [],
    // Possession is what matters — a bracelet transferred to a non-Watch
    // character still opens the channel.
    member: (ctx) => {
      if (ctx.tagSlugs.has("radio-system-watch")) return { view: true, send: true };
      if (ctx.tagSlugs.has("radio-bracelet-watch")) return { view: true, send: false };
      return null;
    },
  },
];

const NARROWCAST_SLUGS = SPECIAL_CHANNELS.map((c) => c.slug);

// Loads the inputs the member rules need for one character. Slugs, not ids —
// the rules are authored against docs/zones.yaml's fixed identifiers. The
// zone is read THROUGH the location (one authority), falling back to the
// denormalized Character.zoneId only for an unplaced character.
async function buildNarrowcastContext(prisma, characterId) {
  const [row, tags] = await Promise.all([
    prisma.character.findUnique({
      where: { id: characterId },
      select: {
        location: { select: { zone: { select: { slug: true, seatZone: { select: { slug: true } } } } } },
        zone: { select: { slug: true, seatZone: { select: { slug: true } } } },
      },
    }),
    prisma.characterTag.findMany({
      where: { characterId },
      select: { tag: { select: { slug: true } } },
    }),
  ]);

  const zone = row?.location?.zone ?? row?.zone ?? null;
  return {
    zoneSlug: zone?.slug ?? null,
    seatZoneSlug: zone?.seatZone?.slug ?? zone?.slug ?? null,
    tagSlugs: new Set(tags.map((t) => t.tag.slug)),
  };
}

// Returns { watch: {view,send}|null, ... } — null means the character gets no
// member overwrite on that channel.
function computeNarrowcastAccess(ctx) {
  return Object.fromEntries(SPECIAL_CHANNELS.map((entry) => [entry.slug, entry.member(ctx)]));
}

module.exports = {
  SPECIAL_CHANNELS,
  NARROWCAST_SLUGS,
  buildNarrowcastContext,
  computeNarrowcastAccess,
};
