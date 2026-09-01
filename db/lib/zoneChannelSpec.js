// The complete intended Discord layout for one Zone — the single description
// both first-time provisioning and the every-run reconcile build from, so the
// two can never disagree (the same role locationChannelSpec played before the
// zone rework, and the one thing in that file that never went wrong).
//
// SURFACE zone: a category named after the zone, holding
//   #summary  text, 5-minute slowmode — abstracted, big-picture play
//   #public   forum — moment-to-moment roleplay in topics; players cannot
//             create posts (the bot does, via the Create-a-Topic button)
//   #private  text — no top-level messages, no player-created threads; the
//             bot spawns private threads from the Create button
// CAVE_GROUP: the category only ("Caves").
// CAVE_LEVEL: a forum named after the level plus a "{level}-private" text
//   channel, both parented to the group's category, with the same rules as a
//   surface #public / #private. The private channel carries the level's slug
//   in its name because all three levels share one category — three channels
//   all named "private" would be indistinguishable in the sidebar. No
//   #summary.
//
// ACCESS: the zone's own "Zone: {Name}" role carries the allow; @everyone
// carries the deny. Every target states its own privacy in full — nothing is
// inherited from the category, because Discord "sync" is a copy at creation
// that drifts independently afterwards (the lesson the per-Location spec
// learned the hard way; see its history in git if you're tempted to slim
// this down).
//
// The VIEW_CHANNEL half of the @everyone deny is the entire mechanism that
// makes a zone private. Every other overwrite here is an allow layered back
// on top of it.
//
// Forum post creation is governed by SEND_MESSAGES on a forum channel —
// denying it on @everyone while allowing SEND_MESSAGES_IN_THREADS is what
// makes posts bot-only while keeping the talk inside them open.
// CREATE_PUBLIC_THREADS/CREATE_PRIVATE_THREADS are denied alongside as
// belt-and-braces.
const { spectatorOverwrite } = require("./spectatorAccess");
const { cursedOverwrite } = require("./cursedAccess");
const { PERSISTENT_TAG_NAME, LOCATION_TAG_NAME, QUEST_TAG_NAME } = require("./persistence");

const CHANNEL_TYPE_TEXT = 0;
const CHANNEL_TYPE_CATEGORY = 4;
const CHANNEL_TYPE_FORUM = 15;

const PERM_VIEW_CHANNEL = 1024n;
const PERM_SEND_MESSAGES = 2048n;
const PERM_ADD_REACTIONS = 64n;
const PERM_ATTACH_FILES = 32768n;
const PERM_MANAGE_MESSAGES = 8192n;
const PERM_MANAGE_THREADS = 17179869184n;
const PERM_CREATE_PUBLIC_THREADS = 34359738368n;
const PERM_CREATE_PRIVATE_THREADS = 68719476736n;
const PERM_SEND_MESSAGES_IN_THREADS = 274877906944n;

// The 5-minute slowmode on #summary — the channel is for abstracted,
// big-picture beats, and the slowmode is what keeps it from becoming a second
// moment-to-moment channel.
const SUMMARY_SLOWMODE_SECONDS = 300;

const SUMMARY_TOPIC =
  "What did people in your zone see your character do over the last 12 hours? Abstracted, big-picture play.";
const PUBLIC_TOPIC =
  "What are you doing right now? Moment-to-moment roleplay. Assign the persistent tag to prevent your location from getting removed.";
const PRIVATE_TOPIC =
  "What are you doing right now? Moment-to-moment private roleplay. Use `/add (character name)` and `/remove (character name)` to control who's in your thread.";

// All three forum tags, no emoji on any of them — the ⏰/🗺 era is over.
const FORUM_TAGS = [{ name: PERSISTENT_TAG_NAME }, { name: LOCATION_TAG_NAME }, { name: QUEST_TAG_NAME }];

// GM gets an explicit overwrite on every channel (not just the category) so
// it can't be clawed back by a channel-level @everyone deny — Discord
// resolves channel overwrites after category ones, and a role with no entry
// of its own falls through to whatever @everyone says there.
const GM_SUMMARY_PERMS =
  PERM_VIEW_CHANNEL + PERM_SEND_MESSAGES + PERM_MANAGE_MESSAGES + PERM_ATTACH_FILES;
const GM_FORUM_PERMS =
  PERM_VIEW_CHANNEL +
  PERM_SEND_MESSAGES +
  PERM_CREATE_PUBLIC_THREADS +
  PERM_SEND_MESSAGES_IN_THREADS +
  PERM_MANAGE_THREADS +
  PERM_MANAGE_MESSAGES +
  PERM_ATTACH_FILES;
const GM_PRIVATE_PERMS =
  PERM_VIEW_CHANNEL +
  PERM_SEND_MESSAGES +
  PERM_CREATE_PRIVATE_THREADS +
  PERM_SEND_MESSAGES_IN_THREADS +
  PERM_MANAGE_THREADS +
  PERM_MANAGE_MESSAGES +
  PERM_ATTACH_FILES;

// Layers a channel's own bits onto the shared base for a target that already
// appears in it, rather than appending a second entry for the same id —
// Discord allows exactly one overwrite per target, and a duplicate would
// silently win or lose depending on ordering.
function mergeOverwrite(base, extra) {
  const merged = base.map((o) => ({ ...o }));
  const existing = merged.find((o) => o.id === extra.id);
  if (!existing) return [...merged, extra];
  existing.allow = String(BigInt(existing.allow ?? "0") | BigInt(extra.allow ?? "0"));
  existing.deny = String(BigInt(existing.deny ?? "0") | BigInt(extra.deny ?? "0"));
  return merged;
}

function roleAllow(roleId, allow) {
  return roleId ? [{ id: roleId, type: 0, allow: allow.toString() }] : [];
}

// The overwrites EVERY target carries: @everyone's deny (the privacy
// mechanism), the GM seat, the spectator seat, and the ghost seat — which
// since the rework covers every zone, cave levels included.
function baseOverwrites(guildId, gmRoleId) {
  return [
    { id: guildId, type: 0, deny: (PERM_VIEW_CHANNEL | PERM_ATTACH_FILES).toString() },
    ...roleAllow(gmRoleId, PERM_VIEW_CHANNEL | PERM_ATTACH_FILES),
    ...spectatorOverwrite(),
    ...cursedOverwrite(),
  ];
}

// The forum payload is identical for a surface #public and a cave-level
// forum; only the name differs.
function forumSpec(name, zoneRoleId, base, gmRoleId, guildId) {
  return {
    name,
    type: CHANNEL_TYPE_FORUM,
    topic: PUBLIC_TOPIC,
    default_auto_archive_duration: 1440,
    available_tags: FORUM_TAGS,
    permission_overwrites: [
      ...roleAllow(gmRoleId, GM_FORUM_PERMS),
      ...roleAllow(
        zoneRoleId,
        PERM_VIEW_CHANNEL | PERM_SEND_MESSAGES_IN_THREADS | PERM_ADD_REACTIONS,
      ),
      // Post creation is SEND_MESSAGES on a forum; deny it (and both thread
      // bits) so players can only talk inside existing posts.
      {
        id: guildId,
        type: 0,
        deny: (
          PERM_SEND_MESSAGES |
          PERM_CREATE_PUBLIC_THREADS |
          PERM_CREATE_PRIVATE_THREADS
        ).toString(),
      },
    ].reduce(mergeOverwrite, base),
  };
}

// The text-channel payload for private scenes — identical for a surface
// #private and a cave level's "{level}-private"; only the name differs.
function privateSpec(name, zoneRoleId, base, gmRoleId, guildId) {
  return {
    name,
    type: CHANNEL_TYPE_TEXT,
    topic: PRIVATE_TOPIC,
    permission_overwrites: [
      ...roleAllow(gmRoleId, GM_PRIVATE_PERMS),
      ...roleAllow(
        zoneRoleId,
        PERM_VIEW_CHANNEL | PERM_SEND_MESSAGES_IN_THREADS | PERM_ADD_REACTIONS,
      ),
      // No top-level messages, and — the rework's point — no player-created
      // threads of either kind. The bot spawns every private thread.
      {
        id: guildId,
        type: 0,
        deny: (
          PERM_SEND_MESSAGES |
          PERM_CREATE_PUBLIC_THREADS |
          PERM_CREATE_PRIVATE_THREADS
        ).toString(),
      },
    ].reduce(mergeOverwrite, base),
  };
}

// The intended layout for one zone, as create payloads minus parent_id
// (which only exists once the category has been made). Which keys are
// present depends on zone.kind:
//   SURFACE     { category, summary, public, private }
//   CAVE_GROUP  { category }
//   CAVE_LEVEL  { public, private }   (parented to the group's category by
//                                      the sync)
function zoneChannelSpec(zone) {
  const guildId = process.env.DISCORD_GUILD_ID;
  const gmRoleId = process.env.DISCORD_GM_ROLE_ID;
  const base = baseOverwrites(guildId, gmRoleId);
  const zoneRoleId = zone.discordRoleId ?? null;

  if (zone.kind === "CAVE_GROUP") {
    return {
      category: { name: zone.name, type: CHANNEL_TYPE_CATEGORY, permission_overwrites: base },
    };
  }

  if (zone.kind === "CAVE_LEVEL") {
    return {
      public: forumSpec(zone.slug, zoneRoleId, base, gmRoleId, guildId),
      private: privateSpec(`${zone.slug}-private`, zoneRoleId, base, gmRoleId, guildId),
    };
  }

  return {
    category: { name: zone.name, type: CHANNEL_TYPE_CATEGORY, permission_overwrites: base },
    summary: {
      name: "summary",
      type: CHANNEL_TYPE_TEXT,
      rate_limit_per_user: SUMMARY_SLOWMODE_SECONDS,
      topic: SUMMARY_TOPIC,
      permission_overwrites: [
        ...roleAllow(gmRoleId, GM_SUMMARY_PERMS),
        ...roleAllow(
          zoneRoleId,
          PERM_VIEW_CHANNEL | PERM_SEND_MESSAGES | PERM_ADD_REACTIONS,
        ),
      ].reduce(mergeOverwrite, base),
    },
    public: forumSpec("public", zoneRoleId, base, gmRoleId, guildId),
    private: privateSpec("private", zoneRoleId, base, gmRoleId, guildId),
  };
}

// The name every zone role wears, and the signature the doctor and
// prune-orphan-roles match on — "Zone: Town".
function zoneRoleName(zone) {
  return `Zone: ${zone.name}`;
}

module.exports = {
  zoneChannelSpec,
  zoneRoleName,
};
