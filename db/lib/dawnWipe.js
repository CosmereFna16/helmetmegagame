// Dawn message wipe: called from db/index.js#advanceTurn() whenever the
// newly-opened turn's phase is DAWN and GameConfig.messageWipeEnabled is
// on. Every Location's plain (summary) channel, public (forum) posts, and
// private-channel threads — plus the guild-wide #radio/#intercom narrowcast
// channels (GameConfig.radioChannelId/intercomChannelId) — get cleared:
//   - plain channel / narrowcast channel: every message deleted.
//   - public forum posts: deleted entirely, UNLESS tagged "Persistent" (⏰)
//     — those survive but have their messages cleared instead — or tagged
//     "Information" (🗺), which is skipped outright: not deleted, not cleared.
//     🗺 is the generated "{Location}: Description" post, whose entire value is
//     the text inside it, so ⏰'s "survives but emptied" is exactly wrong for
//     it. Only db/lib/syncLocations.js ever applies 🗺.
//   - private channel threads: deleted entirely (no top-level messages exist
//     there, only threads — anyone can spin one up, not just GMs), UNLESS the
//     thread's name carries the ⏰ prefix, which is the text-channel
//     equivalent of the forum tag since text channels can't have forum tags.
//     Both markers are set by /persistent; see db/lib/persistence.js.
//
// This used to also ARCHIVE, by reading every message back out of Discord and
// re-posting it into a single #archive channel. That was the most expensive
// thing the bot did — one channel is one ~1 msg/sec rate-limit lane, so a busy
// turn meant hundreds of sequential posts and a wipe measured in tens of
// minutes, growing with player count. It was also lossy and approximate: the
// character was matched by *current* name (a rename mis-attributed everything
// they had ever said), the turn was inferred from timestamps, and attachments
// vanished silently.
//
// The transcript is now recorded at send time instead — db/lib/archive.js,
// called from the proxy paths — and read on the web at /archive. So this file
// only deletes, which is the cheap half: bulkDeleteMessages moves 100 messages
// per request, and at a 12-hour cadence nothing is ever near the 14-day floor
// where bulk delete stops working.
//
// Entirely sequential (no Promise.all fan-out across locations/channels/
// threads) to avoid bursting Discord's rate-limit buckets.
const { PERSISTENT_TAG_NAME, INFORMATION_TAG_NAME, isPersistentThreadName } = require("./persistence");
const {
  fetchAllMessages,
  bulkDeleteMessages,
  listActiveThreadsForChannel,
  listArchivedPublicThreads,
  listArchivedPrivateThreads,
  deleteThread,
  getForumTagId,
} = require("./discordRest");

async function clearMessages(channelOrThreadId) {
  const messages = await fetchAllMessages(channelOrThreadId);
  if (messages.length === 0) return;
  await bulkDeleteMessages(
    channelOrThreadId,
    messages.map((m) => m.id),
  );
}

async function wipePlainChannel(location) {
  if (!location.discordChannelId) return;
  await clearMessages(location.discordChannelId);
}

async function wipeNarrowcastChannel(channelId) {
  if (!channelId) return;
  await clearMessages(channelId);
}

async function collectThreads(channelId, { public: includePublic, private: includePrivate }) {
  const active = await listActiveThreadsForChannel(channelId);
  const archivedPublic = includePublic ? await listArchivedPublicThreads(channelId) : [];
  const archivedPrivate = includePrivate ? await listArchivedPrivateThreads(channelId) : [];

  const byId = new Map();
  for (const thread of [...active, ...archivedPublic, ...archivedPrivate]) byId.set(thread.id, thread);
  return [...byId.values()];
}

async function wipePublicForum(location) {
  if (!location.discordPublicChannelId) return;

  const persistentTagId = await getForumTagId(location.discordPublicChannelId, PERSISTENT_TAG_NAME);
  const informationTagId = await getForumTagId(location.discordPublicChannelId, INFORMATION_TAG_NAME);
  const threads = await collectThreads(location.discordPublicChannelId, { public: true, private: false });

  for (const thread of threads) {
    // Untouched, before either branch: 🗺 is not "survives emptied", it's
    // "the wipe does not reach in here at all".
    if (informationTagId && thread.applied_tags?.includes(informationTagId)) continue;

    const isPersistent = persistentTagId && thread.applied_tags?.includes(persistentTagId);
    if (isPersistent) {
      await clearMessages(thread.id);
    } else {
      await deleteThread(thread.id);
    }
  }
}

async function wipePrivateChannel(location) {
  if (!location.discordPrivateChannelId) return;

  const threads = await collectThreads(location.discordPrivateChannelId, { public: false, private: true });
  for (const thread of threads) {
    // A private thread lives under a TEXT channel, which can't carry forum
    // tags — so persistence is marked by a ⏰ prefix on the thread's own name
    // instead (see db/lib/persistence.js, set by /persistent). Free to check:
    // collectThreads already returns raw thread objects with `name` on them.
    //
    // Surviving keeps the thread's MEMBER LIST as well as the thread, which is
    // the practical point — otherwise a standing secret side-room has to be
    // re-invited every single turn.
    if (isPersistentThreadName(thread.name)) {
      await clearMessages(thread.id);
    } else {
      await deleteThread(thread.id);
    }
  }
}

async function runDawnWipe(prisma) {
  const [locations, config] = await Promise.all([
    prisma.location.findMany({ include: { zone: true } }),
    prisma.gameConfig.findUnique({ where: { id: 1 } }),
  ]);
  const sorted = [...locations].sort((a, b) =>
    `${a.zone.name} / ${a.name}`.localeCompare(`${b.zone.name} / ${b.name}`),
  );

  for (const location of sorted) {
    if (!location.discordCategoryId) continue;
    console.log(`Dawn wipe: ${location.zone.name} / ${location.name}`);
    await wipePlainChannel(location);
    await wipePublicForum(location);
    await wipePrivateChannel(location);
  }

  console.log("Dawn wipe: Radio");
  await wipeNarrowcastChannel(config?.radioChannelId);
  console.log("Dawn wipe: Intercom");
  await wipeNarrowcastChannel(config?.intercomChannelId);
}

module.exports = { runDawnWipe };
