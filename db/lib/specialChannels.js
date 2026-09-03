// The registry of SPECIAL CHANNELS — standing channels outside the zone
// system (#watch, #intercom). Each entry fully describes a
// channel: provisioning, static role grants, per-character access, wipe
// behavior, ghost visibility and tupper routing all derive from it. Adding a
// channel is one entry here plus one GameConfig id column.
//
// Access rules stay CODE: they're real logic over tags and zones, not data a
// YAML mini-language could express cleanly.

const { FORTRESS_SLUG } = require("./constants");

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
  {
    slug: "intercom",
    configKey: "intercomChannelId",
    categoryConfigKey: "radioCategoryId",
    topic: "Ravenheart's PA system. Audible everywhere but the Windlands, where the hurricane winds drown it out. Accessed from the Fortress.",
    tupper: true,
    wipe: "clear",
    ghostsMaySee: true,
    // Audible by everyone with a character, wherever they stand, except the
    // Windlands. Grant view to the zone ROLES rather than a per-member
    // overwrite each, to stay under Discord's per-channel overwrite cap.
    roleViewZones: ["town", "fortress", "caverns", "railroad", "aberrant-pits"],
    // Speaking needs the Intercom tag and standing in the Fortress zone.
    member: (ctx) => {
      if (ctx.tagSlugs.has("intercom") && ctx.zoneSlug === FORTRESS_SLUG) {
        return { view: true, send: true };
      }
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

// Returns { watch: {view,send}|null, intercom: {view,send}|null, ... } — null
// means the character gets no member overwrite on that channel.
function computeNarrowcastAccess(ctx) {
  return Object.fromEntries(SPECIAL_CHANNELS.map((entry) => [entry.slug, entry.member(ctx)]));
}

module.exports = {
  SPECIAL_CHANNELS,
  NARROWCAST_SLUGS,
  buildNarrowcastContext,
  computeNarrowcastAccess,
};
