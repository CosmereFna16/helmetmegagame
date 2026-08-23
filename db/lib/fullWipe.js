// Full Discord channel wipe for a dev-mode game restart (wipeGameData,
// web/app/(app)/gm/dev/actions.js) — distinct from the routine Dawn message
// wipe (dawnWipe.js), which spares anything marked Persistent: a ⏰-tagged
// forum post or a ⏰-prefixed private thread (db/lib/persistence.js). This is
// a hard reset: nothing is spared, whatever it's marked with — including the
// 🗺 Information-tagged "{Location}: Description" posts the Dawn wipe skips
// outright. That's correct: wipeGameData re-runs syncLocationsFromYaml, which
// regenerates them from docs/locations.yaml. Entirely
// sequential, same rate-limit reasoning as dawnWipe.js.
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

  const locations = await prisma.location.findMany();
  for (const location of locations) {
    if (location.discordChannelId) await wipeChannelMessages(location.discordChannelId);
    if (location.discordPublicChannelId) {
      await deleteAllThreads(location.discordPublicChannelId, { public: true, private: false });
    }
    if (location.discordPrivateChannelId) {
      await deleteAllThreads(location.discordPrivateChannelId, { public: false, private: true });
    }
  }
}

module.exports = { runFullChannelWipe };
