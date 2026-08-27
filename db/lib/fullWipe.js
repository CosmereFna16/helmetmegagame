// Full Discord channel wipe for a dev-mode game restart (wipeGameData,
// web/app/(app)/gm/dev/actions.js) — distinct from the routine Dawn message
// wipe (dawnWipe.js), which spares persistent player threads and the
// sync-owned posts. This is a hard reset: nothing is spared, the Location
// topics and Create-a-Topic anchors included. That's correct: wipeGameData
// re-runs syncZonesFromYaml, which regenerates every generated post from
// docs/zones.yaml (their recorded ids are cleared here so the sync rebuilds
// rather than trusting a dangling id). PlayerThread/PlayerThreadInvite rows
// are purged by wipeGameData's DB transaction, not here.
// Entirely sequential, same rate-limit reasoning as dawnWipe.js.
const {
  getGuildChannels,
  fetchAllMessages,
  bulkDeleteMessages,
  listActiveThreadsForChannel,
  listArchivedPublicThreads,
  listArchivedPrivateThreads,
  deleteThread,
} = require("./discordRest");

const CHANNEL_TYPE_TEXT = 0;

async function wipeChannelMessages(channelId) {
  const messages = await fetchAllMessages(channelId);
  if (messages.length > 0) await bulkDeleteMessages(channelId, messages.map((m) => m.id));
}

async function deleteAllThreads(channelId, { public: includePublic, private: includePrivate }) {
  const active = await listActiveThreadsForChannel(channelId);
  const archivedPublic = includePublic ? await listArchivedPublicThreads(channelId) : [];
  const archivedPrivate = includePrivate ? await listArchivedPrivateThreads(channelId) : [];

  const byId = new Map();
  for (const thread of [...active, ...archivedPublic, ...archivedPrivate]) byId.set(thread.id, thread);
  for (const thread of byId.values()) await deleteThread(thread.id);
}

async function runFullChannelWipe(prisma) {
  const channels = await getGuildChannels();

  const archiveChannels = channels.filter((c) => c.type === CHANNEL_TYPE_TEXT && c.name?.toLowerCase() === "archive");
  for (const channel of archiveChannels) await wipeChannelMessages(channel.id);

  const turnsChannel = channels.find((c) => c.type === CHANNEL_TYPE_TEXT && c.name?.toLowerCase() === "turns");
  if (turnsChannel) await wipeChannelMessages(turnsChannel.id);

  const zones = await prisma.zone.findMany();
  for (const zone of zones) {
    if (zone.discordSummaryChannelId) await wipeChannelMessages(zone.discordSummaryChannelId);
    if (zone.discordPublicChannelId) {
      await deleteAllThreads(zone.discordPublicChannelId, { public: true, private: false });
    }
    if (zone.discordPrivateChannelId) {
      await deleteAllThreads(zone.discordPrivateChannelId, { public: false, private: true });
    }
  }

  // The generated posts just went with the threads above; clear their
  // recorded ids (and hashes) so the re-sync rebuilds them instead of
  // hash-matching against a post that no longer exists. The #private anchor
  // message survived (it's a message, not a thread) — its id stays.
  await prisma.zone.updateMany({ data: { createTopicThreadId: null, createTopicHash: null } });
  await prisma.locationTopic.updateMany({ data: { discordThreadId: null, postHash: null } });
}

module.exports = { runFullChannelWipe };
