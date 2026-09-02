// The complete intended Discord layout for one Zone and for one Location —
// the single description both first-time provisioning and the every-run
// reconcile build from, so the two can never disagree.
//
// Every target states its own privacy in full — nothing is inherited from
// the category, because Discord's category "sync" is a one-time copy at
// creation that drifts independently afterwards.
//
// The @everyone VIEW_CHANNEL deny is the entire mechanism that makes a
// channel private; every other overwrite here is an allow layered on top of
// it. Since Bascinet 2 a zone carries only its category and #summary (opened
// by the "Zone: X" role); every Location has its own text channel opened by
// its own "Location: X" role, and its Rooms are threads under it that the
// bot alone may create.
const { spectatorOverwrite } = require("./spectatorAccess");
const { cursedOverwrite } = require("./cursedAccess");

const CHANNEL_TYPE_TEXT = 0;
const CHANNEL_TYPE_CATEGORY = 4;

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

// Discord caps a channel topic at 1024 characters.
const TOPIC_MAX = 1024;

// GM gets an explicit overwrite on every channel (not just the category) so
// it can't be clawed back by a channel-level @everyone deny — Discord
// resolves channel overwrites after category ones, and a role with no entry
// of its own falls through to whatever @everyone says there.
const GM_SUMMARY_PERMS =
  PERM_VIEW_CHANNEL + PERM_SEND_MESSAGES + PERM_MANAGE_MESSAGES + PERM_ATTACH_FILES;
const GM_LOCATION_PERMS =
  PERM_VIEW_CHANNEL +
  PERM_SEND_MESSAGES +
  PERM_CREATE_PUBLIC_THREADS +
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
// mechanism), the GM seat, the spectator seat, and the ghost seat.
function baseOverwrites(guildId, gmRoleId) {
  return [
    { id: guildId, type: 0, deny: (PERM_VIEW_CHANNEL | PERM_ATTACH_FILES).toString() },
    ...roleAllow(gmRoleId, PERM_VIEW_CHANNEL | PERM_ATTACH_FILES),
    ...spectatorOverwrite(),
    ...cursedOverwrite(),
  ];
}

// The intended layout for one zone, as create payloads minus parent_id
// (which only exists once the category has been made). Which keys are
// present depends on zone.kind:
//   SURFACE     { category, summary }
//   CAVE_GROUP  { category }
//   CAVE_LEVEL  { }   (its Location channels parent to the group's category)
function zoneChannelSpec(zone) {
  const guildId = process.env.DISCORD_GUILD_ID;
  const gmRoleId = process.env.DISCORD_GM_ROLE_ID;
  const base = baseOverwrites(guildId, gmRoleId);
  const zoneRoleId = zone.discordRoleId ?? null;

  if (zone.kind === "CAVE_LEVEL") return {};

  const category = { name: zone.name, type: CHANNEL_TYPE_CATEGORY, permission_overwrites: base };
  if (zone.kind === "CAVE_GROUP") return { category };

  return {
    category,
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
  };
}

// The text channel for one Location. Its role may talk at top level (the
// location's open street) and inside its Room threads, but may create no
// thread of either kind — the bot spawns every Room and every Conversation,
// which is what keeps PlayerThread a complete record.
function locationChannelSpec(location) {
  const guildId = process.env.DISCORD_GUILD_ID;
  const gmRoleId = process.env.DISCORD_GM_ROLE_ID;
  const base = baseOverwrites(guildId, gmRoleId);
  const topic = (location.description || "").replace(/\s*\n+\s*/g, " ").trim().slice(0, TOPIC_MAX);

  return {
    name: location.slug,
    type: CHANNEL_TYPE_TEXT,
    topic,
    permission_overwrites: [
      ...roleAllow(gmRoleId, GM_LOCATION_PERMS),
      ...roleAllow(
        location.discordRoleId ?? null,
        PERM_VIEW_CHANNEL | PERM_SEND_MESSAGES | PERM_SEND_MESSAGES_IN_THREADS | PERM_ADD_REACTIONS,
      ),
      {
        id: guildId,
        type: 0,
        deny: (PERM_CREATE_PUBLIC_THREADS | PERM_CREATE_PRIVATE_THREADS).toString(),
      },
    ].reduce(mergeOverwrite, base),
  };
}

// The names the roles wear, and the signatures the doctor and
// prune-orphan-roles match on — "Zone: Town", "Location: Square".
function zoneRoleName(zone) {
  return `Zone: ${zone.name}`;
}

function locationRoleName(location) {
  return `Location: ${location.name}`;
}

module.exports = {
  zoneChannelSpec,
  locationChannelSpec,
  zoneRoleName,
  locationRoleName,
};
