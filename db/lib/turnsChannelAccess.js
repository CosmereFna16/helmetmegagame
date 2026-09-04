// Who can see #turns — the rolling console (turn announcement, weather
// banner, Travel/Move/Speak buttons) every player needs. The gate is the
// zone role, the same trick the retired #intercom used (db/lib/specialChannels.js,
// `roleViewZones`): every living character holds exactly one "Zone: X" role,
// so @everyone is denied the view and every zone role is allowed it.
// SendMessages stays denied to @everyone — the buttons are components, not
// messages. Applied, idempotently, from bot/src/lib/turnsConsole.js on every
// bot ready, from db/lib/syncZones.js after the zone-role pass, and from
// db/lib/channelDoctor.js for drift reporting and repair.
const {
  getGuildChannels,
  getGuildRoles,
  getChannel,
  putChannelOverwrite,
  deleteChannelOverwrite,
} = require("./discordRest");
const { applySpectatorOverwrite, SPECTATOR_ALLOW, SPECTATOR_DENY } = require("./spectatorAccess");
const { applyCursedOverwrite, cursedRoleId, CURSED_ALLOW, CURSED_DENY } = require("./cursedAccess");
const { SPECTATOR_ROLE_ID } = require("./roleIds");

const CHANNEL_TYPE_TEXT = 0;

const PERM_VIEW_CHANNEL = 1024n;
const PERM_SEND_MESSAGES = 2048n;
const PERM_ATTACH_FILES = 32768n;

const EVERYONE_DENY = PERM_VIEW_CHANNEL | PERM_SEND_MESSAGES | PERM_ATTACH_FILES;
const GM_ALLOW = PERM_VIEW_CHANNEL | PERM_SEND_MESSAGES | PERM_ATTACH_FILES;

// The canonical exact-name match. There is only ever meant to be one #turns,
// and nothing in the repo creates it — bot/src/lib/turnsConsole.js and
// db/lib/turnAnnouncement.js both require it from here rather than keeping
// their own copy. It works on a raw REST channel and on a discord.js gateway
// channel alike, since ChannelType.GuildText is 0.
function isTurnsChannel(channel) {
  return channel?.type === CHANNEL_TYPE_TEXT && channel.name?.toLowerCase() === "turns";
}

// The intended overwrite set, as a Map keyed on target id — what the channel
// doctor compares the live channel against. Order does not matter; Discord
// allows exactly one overwrite per target.
function turnsChannelOverwrites({ guildId, gmRoleId, zoneRoleIds }) {
  const wanted = new Map();
  if (guildId) wanted.set(guildId, { id: guildId, type: 0, allow: "0", deny: EVERYONE_DENY.toString() });
  if (gmRoleId) wanted.set(gmRoleId, { id: gmRoleId, type: 0, allow: GM_ALLOW.toString(), deny: "0" });
  wanted.set(SPECTATOR_ROLE_ID, {
    id: SPECTATOR_ROLE_ID,
    type: 0,
    allow: SPECTATOR_ALLOW.toString(),
    deny: SPECTATOR_DENY.toString(),
  });
  const cursed = cursedRoleId();
  if (cursed) {
    wanted.set(cursed, {
      id: cursed,
      type: 0,
      allow: CURSED_ALLOW.toString(),
      deny: CURSED_DENY.toString(),
    });
  }
  for (const roleId of zoneRoleIds) {
    if (!roleId || wanted.has(roleId)) continue;
    wanted.set(roleId, { id: roleId, type: 0, allow: PERM_VIEW_CHANNEL.toString(), deny: "0" });
  }
  return wanted;
}

// Resolves #turns by name. Returns null when the guild has none, which every
// caller tolerates — a missing #turns is already reported loudly by
// ensureTurnsConsole.
async function findTurnsChannelId() {
  const channels = await getGuildChannels();
  return channels.find(isTurnsChannel)?.id ?? null;
}

async function zoneRoleIdsFor(prisma) {
  const zones = await prisma.zone.findMany({
    where: { discordRoleId: { not: null } },
    select: { discordRoleId: true },
  });
  return zones.map((z) => z.discordRoleId);
}

// Idempotent, safe to re-run. Single-target PUTs throughout rather than a
// PATCH of the whole permission_overwrites array, so this never clobbers an
// overwrite it does not own — same reasoning as spectatorAccess.js.
async function syncTurnsChannelAccess(prisma, { channelId = null } = {}) {
  const guildId = process.env.DISCORD_GUILD_ID;
  const gmRoleId = process.env.DISCORD_GM_ROLE_ID;
  if (!guildId || !process.env.DISCORD_TOKEN) return { ok: false, reason: "unconfigured" };

  const id = channelId ?? (await findTurnsChannelId());
  if (!id) return { ok: false, reason: "missing" };

  await putChannelOverwrite(id, guildId, { deny: EVERYONE_DENY.toString() });
  if (gmRoleId) await putChannelOverwrite(id, gmRoleId, { allow: GM_ALLOW.toString() });
  await applySpectatorOverwrite(id);
  await applyCursedOverwrite(id);

  const zoneRoleIds = await zoneRoleIdsFor(prisma);
  let roleGrants = 0;
  for (const roleId of zoneRoleIds) {
    if (roleId === gmRoleId || roleId === SPECTATOR_ROLE_ID || roleId === cursedRoleId()) continue;
    await putChannelOverwrite(id, roleId, { allow: PERM_VIEW_CHANNEL.toString() });
    roleGrants += 1;
  }

  // Strip everything this spec does not name. The set above is the COMPLETE
  // description of who may see #turns, the way zoneChannelSpec.js is for a
  // zone channel, so anything else is a leftover from the hand-managed era:
  // the per-member overrides GMs added one player at a time, and the Player
  // role's view grant — which said "approved to make a character", not "has
  // one", and so kept the channel open to people with no character at all.
  const wanted = turnsChannelOverwrites({ guildId, gmRoleId, zoneRoleIds });
  const botRoleIds = new Set(
    (await getGuildRoles().catch(() => [])).filter((r) => r.tags?.bot_id).map((r) => r.id),
  );
  let stripped = 0;
  const live = await getChannel(id, { allow404: true }).catch(() => null);
  for (const overwrite of live?.permission_overwrites ?? []) {
    if (wanted.has(overwrite.id)) continue;
    // Never touch a bot's own overwrite. Ours is Administrator so it has none
    // today, but a guild where it isn't would lose the channel it posts to.
    if (botRoleIds.has(overwrite.id)) continue;
    await deleteChannelOverwrite(id, overwrite.id).catch(() => {});
    stripped += 1;
  }

  return { ok: true, channelId: id, roleGrants, stripped };
}

module.exports = {
  isTurnsChannel,
  findTurnsChannelId,
  turnsChannelOverwrites,
  syncTurnsChannelAccess,
};
