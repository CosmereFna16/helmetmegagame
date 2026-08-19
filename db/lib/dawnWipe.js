// Dawn message wipe: called from db/index.js#advanceTurn() whenever the
// newly-opened turn's phase is DAWN and GameConfig.messageWipeEnabled is
// on. Every Location's plain (summary) channel, public (forum) posts, and
// private-channel threads get archived to a single guild-wide #archive
// channel (chronological order per channel/thread, batched into as few
// messages as possible) and then cleared:
//   - plain channel: every message deleted.
//   - public forum posts: deleted entirely, UNLESS tagged "Persistent" (⏰)
//     — those survive but have their messages cleared instead.
//   - private channel threads: always deleted entirely (no top-level
//     messages exist there, only threads — anyone can spin one up, not
//     just GMs).
//
// Entirely sequential (no Promise.all fan-out across locations/channels/
// threads) to avoid bursting Discord's rate-limit buckets. Every
// channel/thread is archived *before* it's touched for deletion, so a
// mid-run crash leaves "not yet wiped," never "wiped without being
// archived" — treated as an accepted known limitation (no checkpoint/
// resume machinery), same framing as the node-cron catch-up gap already
// documented in docs/systemdocs/ARCHITECTURE.md.
const {
  getGuildChannels,
  postMessage,
  fetchAllMessages,
  bulkDeleteMessages,
  listActiveThreadsForChannel,
  listArchivedPublicThreads,
  listArchivedPrivateThreads,
  deleteThread,
  getForumTagId,
} = require("./discordRest");

const PERSISTENT_TAG_NAME = "Persistent";
const DISCORD_MESSAGE_LIMIT = 2000;

function formatLine(zoneName, locationName, message) {
  return `\`[${zoneName} / ${locationName}]\` **${message.author.username}**: ${message.content}`;
}

// Batches lines into as few messages as possible under the char cap. A
// single line that alone exceeds the cap (a near-max-length original
// message) is hard-split across multiple continuation messages.
function batchLines(lines) {
  const batches = [];
  let current = "";

  for (const line of lines) {
    for (let i = 0; i < line.length; i += DISCORD_MESSAGE_LIMIT) {
      const piece = line.slice(i, i + DISCORD_MESSAGE_LIMIT);
      const candidate = current ? `${current}\n${piece}` : piece;
      if (candidate.length > DISCORD_MESSAGE_LIMIT) {
        if (current) batches.push(current);
        current = piece;
      } else {
        current = candidate;
      }
    }
  }
  if (current) batches.push(current);
  return batches;
}

async function postArchiveBatches(archiveChannelId, lines) {
  for (const batch of batchLines(lines)) {
    await postMessage(archiveChannelId, batch);
  }
}

// Archives every message in a channel/thread to #archive, then returns the
// archived message ids (for the caller to delete) — or null if there was
// nothing to archive.
async function archiveMessages(archiveChannelId, zoneName, locationName, channelOrThreadId) {
  const messages = await fetchAllMessages(channelOrThreadId);
  if (messages.length === 0) return null;

  const lines = messages
    .filter((m) => m.content || m.attachments?.length)
    .map((m) => formatLine(zoneName, locationName, m));
  if (lines.length > 0) await postArchiveBatches(archiveChannelId, lines);

  return messages.map((m) => m.id);
}

async function wipePlainChannel(archiveChannelId, zoneName, location) {
  if (!location.discordChannelId) return;
  const ids = await archiveMessages(archiveChannelId, zoneName, location.name, location.discordChannelId);
  if (ids?.length) await bulkDeleteMessages(location.discordChannelId, ids);
}

async function collectThreads(channelId, { public: includePublic, private: includePrivate }) {
  const active = await listActiveThreadsForChannel(channelId);
  const archivedPublic = includePublic ? await listArchivedPublicThreads(channelId) : [];
  const archivedPrivate = includePrivate ? await listArchivedPrivateThreads(channelId) : [];

  const byId = new Map();
  for (const thread of [...active, ...archivedPublic, ...archivedPrivate]) byId.set(thread.id, thread);
  return [...byId.values()];
}

async function wipePublicForum(archiveChannelId, zoneName, location) {
  if (!location.discordPublicChannelId) return;

  const persistentTagId = await getForumTagId(location.discordPublicChannelId, PERSISTENT_TAG_NAME);
  const threads = await collectThreads(location.discordPublicChannelId, { public: true, private: false });

  for (const thread of threads) {
    const ids = await archiveMessages(archiveChannelId, zoneName, location.name, thread.id);
    const isPersistent = persistentTagId && thread.applied_tags?.includes(persistentTagId);

    if (isPersistent) {
      if (ids?.length) await bulkDeleteMessages(thread.id, ids);
    } else {
      await deleteThread(thread.id);
    }
  }
}

async function wipePrivateChannel(archiveChannelId, zoneName, location) {
  if (!location.discordPrivateChannelId) return;

  const threads = await collectThreads(location.discordPrivateChannelId, { public: false, private: true });
  for (const thread of threads) {
    await archiveMessages(archiveChannelId, zoneName, location.name, thread.id);
    await deleteThread(thread.id);
  }
}

async function runDawnWipe(prisma) {
  const channels = await getGuildChannels();
  const archiveChannel = channels.find((c) => c.type === 0 && c.name?.toLowerCase() === "archive");
  if (!archiveChannel) {
    console.error("Dawn wipe: no #archive channel found, skipping.");
    return;
  }

  const locations = await prisma.location.findMany({ include: { zone: true } });
  const sorted = [...locations].sort((a, b) =>
    `${a.zone.name} / ${a.name}`.localeCompare(`${b.zone.name} / ${b.name}`),
  );

  for (const location of sorted) {
    if (!location.discordCategoryId) continue;
    console.log(`Dawn wipe: ${location.zone.name} / ${location.name}`);
    await wipePlainChannel(archiveChannel.id, location.zone.name, location);
    await wipePublicForum(archiveChannel.id, location.zone.name, location);
    await wipePrivateChannel(archiveChannel.id, location.zone.name, location);
  }
}

module.exports = { runDawnWipe };
