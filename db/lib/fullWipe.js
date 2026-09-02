// Full Discord channel wipe for a dev-mode game restart (wipeGameData,
// web/app/(app)/gm/dev/actions.js) — distinct from the routine Dawn message
// wipe (dawnWipe.js), which spares the Room threads' starters and the
// location anchors. This is a hard reset: nothing is spared, Rooms and
// anchors included. That's correct: wipeGameData re-runs syncZonesFromYaml,
// which regenerates every Room thread and anchor from docs/zones.yaml (their
// recorded ids are cleared here so the sync rebuilds rather than trusting a
// dangling id). PlayerThread/PlayerThreadInvite rows are purged by
// wipeGameData's DB transaction, not here.
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

  const zones = await prisma.zone.findMany({ include: { locations: true } });
  for (const zone of zones) {
    if (zone.discordSummaryChannelId) await wipeChannelMessages(zone.discordSummaryChannelId);
    for (const location of zone.locations) {
      if (!location.discordChannelId) continue;
      await deleteAllThreads(location.discordChannelId, { public: true, private: true });
      await wipeChannelMessages(location.discordChannelId);
    }
  }

  // The Room threads and anchors just went; clear their recorded ids (and
  // hashes) so the re-sync rebuilds them instead of hash-matching against
  // something that no longer exists.
  await prisma.location.updateMany({ data: { anchorMessageId: null, anchorHash: null } });
  await prisma.room.updateMany({ data: { discordThreadId: null, starterMessageId: null, postHash: null } });
}

module.exports = { runFullChannelWipe };
