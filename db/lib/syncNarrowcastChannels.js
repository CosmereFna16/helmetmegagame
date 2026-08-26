// One-off provisioning for the two hardcoded narrowcast channels (#watch,
// #intercom), both parented under a shared Discord "radio" category. Run by
// db/prisma/sync-narrowcast-channels.js (`npm run db:sync-narrowcast-channels`).
// Per-character access on these channels is granted separately, as a
// character's tags/Location change — see db/lib/narrowcastAccess.js (rules)
// and bot/src/lib/location.js / web/lib/discordGuild.js (the gateway/REST
// syncs) — this module only ever creates the category and the channels and
// sets their default @everyone deny. An already-provisioned channel or
// category (tracked via GameConfig.radioCategoryId / watchChannelId /
// intercomChannelId) is never renamed or recreated, but its parent is
// reconciled: an intercom that was created before this file grew its
// category step is moved under the new one on the next run.
const { getGuildChannels, createChannel, patchChannel, putChannelOverwrite } = require("./discordRest");
const { applySpectatorOverwrite } = require("./spectatorAccess");
const { applyCursedOverwrite } = require("./cursedAccess");

const PERM_VIEW_CHANNEL = 1024n;
const PERM_SEND_MESSAGES = 2048n;
const PERM_ATTACH_FILES = 32768n;
const CHANNEL_TYPE_TEXT = 0;
const CHANNEL_TYPE_CATEGORY = 4;

const CATEGORY_NAME = "radio";
const CHANNELS = [
  {
    name: "watch",
    topic: "The Watch's radio net. Bracelets receive; the Captain's system speaks.",
    configKey: "watchChannelId",
  },
  {
    name: "intercom",
    topic: "Ravenheart's PA system. Only the Town and Fortress are in range. Accessed from the Keep.",
    configKey: "intercomChannelId",
  },
];

async function ensureCategory(prisma, config, guildChannels) {
  const knownId = config.radioCategoryId;
  if (knownId && guildChannels.some((c) => c.id === knownId && c.type === CHANNEL_TYPE_CATEGORY)) {
    return knownId;
  }
  // Recover a category that already exists in Discord by name (e.g. the DB
  // was rebuilt) rather than creating a duplicate.
  const existing = guildChannels.find((c) => c.type === CHANNEL_TYPE_CATEGORY && c.name === CATEGORY_NAME);
  const id = existing ? existing.id : (await createChannel({ name: CATEGORY_NAME, type: CHANNEL_TYPE_CATEGORY })).id;
  if (!existing) console.log(`provisioned category #${CATEGORY_NAME}`);
  await prisma.gameConfig.update({ where: { id: 1 }, data: { radioCategoryId: id } });
  return id;
}

async function syncNarrowcastChannels(prisma) {
  const guildId = process.env.DISCORD_GUILD_ID;
  const gmRoleId = process.env.DISCORD_GM_ROLE_ID;
  if (!guildId || !process.env.DISCORD_TOKEN) {
    throw new Error("DISCORD_GUILD_ID and DISCORD_TOKEN must be set.");
  }

  const config = await prisma.gameConfig.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } });
  const guildChannels = await getGuildChannels();
  const stats = { provisioned: [], reparented: [] };

  const categoryId = await ensureCategory(prisma, config, guildChannels);

  for (const entry of CHANNELS) {
    const knownId = config[entry.configKey];
    const known = knownId ? guildChannels.find((c) => c.id === knownId) : null;

    if (known) {
      // Existing channel: only reconcile the parent if it drifted (e.g. the
      // legacy #intercom that predates the category). A single PATCH with
      // just `parent_id`, per CHANNELS.md's warning against combining with
      // bulk position updates.
      if (known.parent_id !== categoryId) {
        await patchChannel(known.id, { parent_id: categoryId });
        stats.reparented.push(entry.name);
        console.log(`moved #${entry.name} under #${CATEGORY_NAME}`);
      }
      continue;
    }

    // Recover an unparented same-name channel from a rebuilt DB before
    // creating a duplicate.
    const existing = guildChannels.find((c) => c.type === CHANNEL_TYPE_TEXT && c.name === entry.name);
    let newChannelId;
    if (existing) {
      newChannelId = existing.id;
      if (existing.parent_id !== categoryId) {
        await patchChannel(existing.id, { parent_id: categoryId });
        stats.reparented.push(entry.name);
      }
    } else {
      const created = await createChannel({
        name: entry.name,
        type: CHANNEL_TYPE_TEXT,
        topic: entry.topic,
        parent_id: categoryId,
      });
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
    // Spectators read #watch/#intercom the same way they read a Location:
    // visible, never speakable.
    await applySpectatorOverwrite(newChannelId);
    // Ghosts hear the radio too. The 🌬️ whisper deliberately does NOT work
    // here — see bot/src/events/messageReactionAdd.js, which accepts only a
    // Location's summary channel or a forum post.
    await applyCursedOverwrite(newChannelId);
    await prisma.gameConfig.update({ where: { id: 1 }, data: { [entry.configKey]: newChannelId } });
  }

  return stats;
}

module.exports = { syncNarrowcastChannels };
