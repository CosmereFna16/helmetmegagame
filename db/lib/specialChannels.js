// The registry of SPECIAL CHANNELS — standing channels outside the zone
// system (#watch, #intercom today; more will come). One entry here fully
// describes a channel: provisioning, static role grants, the per-character
// access rule, wipe behavior, ghost visibility and tupper routing all derive
// from it. Adding a future special channel is one entry in this array plus
// one GameConfig id column — nothing else to touch.
//
// Rules stay CODE, deliberately: a special channel's access condition is real
// logic over tags and zones, and a YAML mini-language would only be a worse
// programming language. What the registry buys is that the logic lives in one
// self-contained object instead of being smeared across a provisioning
// script, two access-sync twins and the wipe.
//
// Entry shape:
//   slug              stable key, also the channel's Discord name
//   configKey         GameConfig column holding the channel id
//   categoryConfigKey GameConfig column holding the shared category's id
//   topic             the channel topic, re-asserted every sync
//   tupper            true = the proxy pipeline treats it like a roleplay
//                     channel (bot/src/lib/channels.js and
//                     web/lib/discordGuild.js build their sets from this)
//   wipe              "clear" = the Dawn wipe bulk-deletes its messages;
//                     "skip" = never touched
//   ghostsMaySee      whether the Cursed seat gets its read-only overwrite
//   roleViewZones     zone SLUGS whose "Zone: X" role gets a ViewChannel
//                     allow — a static, role-based floor under the
//                     per-member rule. Re-applied every sync.
//   member(ctx)       per-character rule → { view, send } | null. null means
//                     no overwrite at all (falls back to @everyone's deny —
//                     or to a roleViewZones grant the character's zone role
//                     carries). Evaluated by computeNarrowcastAccess and
//                     applied as a MEMBER overwrite by the two
//                     syncCharacterNarrowcastAccess twins.
//
// ctx is built by buildNarrowcastContext below:
//   { zoneSlug, seatZoneSlug, tagSlugs }

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
    topic: "Ravenheart's PA system. Audible everywhere. Accessed from the Fortress.",
    tupper: true,
    wipe: "clear",
    ghostsMaySee: true,
    // Audible by everyone with a character, wherever they stand — the PA
    // reaches the whole map. Granting view to the zone ROLES (rather than a
    // per-member overwrite each) is also what retired the ~100-overwrite
    // ceiling this channel used to be drifting toward.
    roleViewZones: ["town", "fortress", "windlands", "caverns", "railroad", "aberrant-pits"],
    // Speaking needs the Intercom tag and boots on Fortress ground. The old
    // rule said "standing in the Keep"; the Keep is prose now, so the
    // Fortress zone is the gate.
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
// the rules are authored against docs/zones.yaml's fixed identifiers.
async function buildNarrowcastContext(prisma, characterId) {
  const [character, tags] = await Promise.all([
    prisma.character.findUnique({
      where: { id: characterId },
      select: { zone: { select: { slug: true, seatZone: { select: { slug: true } } } } },
    }),
    prisma.characterTag.findMany({
      where: { characterId },
      select: { tag: { select: { slug: true } } },
    }),
  ]);

  return {
    zoneSlug: character?.zone?.slug ?? null,
    seatZoneSlug: character?.zone?.seatZone?.slug ?? character?.zone?.slug ?? null,
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
