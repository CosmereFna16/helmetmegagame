// One-off provisioning for the two hardcoded narrowcast channels (#radio,
// #intercom). Run by db/prisma/sync-narrowcast-channels.js
// (`npm run db:sync-narrowcast-channels`). Per-character access on these
// channels is granted separately, as a character's tags/Location change —
// see db/lib/narrowcastAccess.js (rules) and
// bot/src/lib/location.js / web/lib/discordGuild.js (the gateway/REST
// syncs) — this module only ever creates the channel and sets its default
// @everyone deny, exactly once. An already-provisioned channel (tracked via
// GameConfig.radioChannelId/intercomChannelId) is never renamed, recreated,
// or have its overwrites reset again.
const { getGuildChannels, createChannel, putChannelOverwrite } = require("./discordRest");
const { applySpectatorOverwrite } = require("./spectatorAccess");

const PERM_VIEW_CHANNEL = 1024n;
const PERM_SEND_MESSAGES = 2048n;
const PERM_ATTACH_FILES = 32768n;
const CHANNEL_TYPE_TEXT = 0;

const CHANNELS = [
  {
    name: "radio",
    topic: "Crackling long-range voice traffic. Only those with a set can hear it.",
    configKey: "radioChannelId",
  },
  {
    name: "intercom",
    topic: "Ravenheart's PA system. Only the Town and Fortress are in range. Accessed from the Keep.",
    configKey: "intercomChannelId",
  },
];

async function syncNarrowcastChannels(prisma) {
  const guildId = process.env.DISCORD_GUILD_ID;
  const gmRoleId = process.env.DISCORD_GM_ROLE_ID;
  if (!guildId || !process.env.DISCORD_TOKEN) {
    throw new Error("DISCORD_GUILD_ID and DISCORD_TOKEN must be set.");
  }

  const config = await prisma.gameConfig.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } });
  const guildChannels = await getGuildChannels();
  const stats = { provisioned: [] };

  for (const entry of CHANNELS) {
    const channelId = config[entry.configKey];
    if (channelId && guildChannels.some((c) => c.id === channelId)) continue;

    // Recover a channel that already exists in Discord by name (e.g. the DB
    // was rebuilt) rather than creating a duplicate.
    const existing = guildChannels.find((c) => c.type === CHANNEL_TYPE_TEXT && c.name === entry.name);
    let newChannelId;
    if (existing) {
      newChannelId = existing.id;
    } else {
      const created = await createChannel({ name: entry.name, type: CHANNEL_TYPE_TEXT, topic: entry.topic });
      newChannelId = created.id;
      stats.provisioned.push(entry.name);
      console.log(`provisioned #${entry.name}`);
    }

    // @everyone is denied view/send by default; per-character access is
    // granted separately as tags/location change. ATTACH_FILES is denied
    // here too and never granted back by the per-character view/send
    // overwrites in narrowcastAccess.js, so it stays off for every player
    // regardless of access. GM gets an explicit allow so moderation posts
    // with attachments still work.
    await putChannelOverwrite(newChannelId, guildId, { deny: (PERM_VIEW_CHANNEL | PERM_SEND_MESSAGES | PERM_ATTACH_FILES).toString() });
    if (gmRoleId) {
      await putChannelOverwrite(newChannelId, gmRoleId, { allow: PERM_ATTACH_FILES.toString() });
    }
    // Spectators read #radio/#intercom the same way they read a Location:
    // visible, never speakable.
    await applySpectatorOverwrite(newChannelId);
    await prisma.gameConfig.update({ where: { id: 1 }, data: { [entry.configKey]: newChannelId } });
  }

  return stats;
}

module.exports = { syncNarrowcastChannels };
