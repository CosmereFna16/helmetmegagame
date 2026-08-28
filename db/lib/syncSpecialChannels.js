// Provisioning + reconciliation for the SPECIAL CHANNELS registry
// (db/lib/specialChannels.js) — #watch, #intercom, and whatever joins them.
// Run by db/prisma/sync-narrowcast-channels.js (`npm run
// db:sync-narrowcast-channels`) and from wipeGameData's Restart Game flow.
//
// Everything here derives from the registry entry: the category, the channel,
// its topic, the @everyone deny, the spectator/ghost seats, and the static
// zone-role view grants. Per-CHARACTER access (the entry's member rule) is
// applied elsewhere, as tags/zone change — see the two
// syncCharacterNarrowcastAccess twins.
//
// Unlike the pre-rework version this reconciles on every run, not just at
// creation: topics drift, zone roles get recreated, and a channel that
// misses its roleView grants is a channel nobody can hear. Channel identity
// (name, id) stays one-time.
const {
  getGuildChannels,
  createChannel,
  patchChannel,
  putChannelOverwrite,
} = require("./discordRest");
const { applySpectatorOverwrite } = require("./spectatorAccess");
const { applyCursedOverwrite } = require("./cursedAccess");
const { SPECIAL_CHANNELS } = require("./specialChannels");

const PERM_VIEW_CHANNEL = 1024n;
const PERM_SEND_MESSAGES = 2048n;
const PERM_ATTACH_FILES = 32768n;
const CHANNEL_TYPE_TEXT = 0;
const CHANNEL_TYPE_CATEGORY = 4;

const CATEGORY_NAME = "Radio";

async function ensureCategory(prisma, config, guildChannels, categoryConfigKey) {
  const knownId = config[categoryConfigKey];
  if (knownId && guildChannels.some((c) => c.id === knownId && c.type === CHANNEL_TYPE_CATEGORY)) {
    return knownId;
  }
  // Recover a category that already exists in Discord by name (e.g. the DB
  // was rebuilt) rather than creating a duplicate.
  const existing = guildChannels.find(
    (c) => c.type === CHANNEL_TYPE_CATEGORY && c.name === CATEGORY_NAME,
  );
  const id = existing
    ? existing.id
    : (await createChannel({ name: CATEGORY_NAME, type: CHANNEL_TYPE_CATEGORY })).id;
  if (!existing) console.log(`provisioned category #${CATEGORY_NAME}`);
  await prisma.gameConfig.update({ where: { id: 1 }, data: { [categoryConfigKey]: id } });
  return id;
}

async function syncSpecialChannels(prisma) {
  const guildId = process.env.DISCORD_GUILD_ID;
  const gmRoleId = process.env.DISCORD_GM_ROLE_ID;
  if (!guildId || !process.env.DISCORD_TOKEN) {
    throw new Error("DISCORD_GUILD_ID and DISCORD_TOKEN must be set.");
  }

  const config = await prisma.gameConfig.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } });
  const guildChannels = await getGuildChannels();
  const stats = { provisioned: [], reparented: [], roleGrants: 0 };

  // Zone roles for the static roleView grants, resolved once by slug.
  const zones = await prisma.zone.findMany({
    where: { discordRoleId: { not: null } },
    select: { slug: true, discordRoleId: true },
  });
  const roleBySlug = new Map(zones.map((z) => [z.slug, z.discordRoleId]));

  for (const entry of SPECIAL_CHANNELS) {
    const categoryId = await ensureCategory(prisma, config, guildChannels, entry.categoryConfigKey);

    let channelId = config[entry.configKey];
    const known = channelId ? guildChannels.find((c) => c.id === channelId) : null;

    if (!known) {
      // Recover an unparented same-name channel from a rebuilt DB before
      // creating a duplicate.
      const existing = guildChannels.find(
        (c) => c.type === CHANNEL_TYPE_TEXT && c.name === entry.slug,
      );
      if (existing) {
        channelId = existing.id;
      } else {
        const created = await createChannel({
          name: entry.slug,
          type: CHANNEL_TYPE_TEXT,
          topic: entry.topic,
          parent_id: categoryId,
        });
        channelId = created.id;
        stats.provisioned.push(entry.slug);
        console.log(`provisioned #${entry.slug}`);
      }
      await prisma.gameConfig.update({ where: { id: 1 }, data: { [entry.configKey]: channelId } });
    } else if (known.parent_id !== categoryId) {
      // A single PATCH with just parent_id, per CHANNELS.md's warning against
      // combining it with bulk position updates.
      await patchChannel(channelId, { parent_id: categoryId });
      stats.reparented.push(entry.slug);
    }

    // Reconciled every run from here down. @everyone is denied view/send;
    // ATTACH_FILES is denied and never granted back by any player-facing
    // overwrite. GM gets an explicit attach allow so moderation posts with
    // attachments still work.
    await patchChannel(channelId, {
      topic: entry.topic,
      ...(entry.slowmode !== undefined ? { rate_limit_per_user: entry.slowmode } : {}),
    });
    await putChannelOverwrite(channelId, guildId, {
      deny: (PERM_VIEW_CHANNEL | PERM_SEND_MESSAGES | PERM_ATTACH_FILES).toString(),
    });
    if (gmRoleId) {
      await putChannelOverwrite(channelId, gmRoleId, {
        allow: (PERM_VIEW_CHANNEL | PERM_SEND_MESSAGES | PERM_ATTACH_FILES).toString(),
      });
    }
    await applySpectatorOverwrite(channelId);
    if (entry.ghostsMaySee) await applyCursedOverwrite(channelId);

    // The static zone-role floor: every listed zone's role hears the channel.
    for (const slug of entry.roleViewZones ?? []) {
      const roleId = roleBySlug.get(slug);
      if (!roleId) continue;
      await putChannelOverwrite(channelId, roleId, { allow: PERM_VIEW_CHANNEL.toString() });
      stats.roleGrants += 1;
    }
  }

  return stats;
}

module.exports = { syncSpecialChannels };
