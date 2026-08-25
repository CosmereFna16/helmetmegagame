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
  fetchActiveThreads,
  getChannel,
  listArchivedPublicThreads,
  listArchivedPrivateThreads,
  deleteThread,
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

async function collectThreads(channelId, { public: includePublic, private: includePrivate }, activeSnapshot) {
  const active = await listActiveThreadsForChannel(channelId, activeSnapshot);
  const archivedPublic = includePublic ? await listArchivedPublicThreads(channelId) : [];
  const archivedPrivate = includePrivate ? await listArchivedPrivateThreads(channelId) : [];

  const byId = new Map();
  for (const thread of [...active, ...archivedPublic, ...archivedPrivate]) byId.set(thread.id, thread);
  return [...byId.values()];
}

async function wipePublicForum(location, activeSnapshot) {
  if (!location.discordPublicChannelId) return;

  // One channel fetch for both tag ids rather than one each: getForumTagId
  // fetches the whole channel to read available_tags off it, so asking twice
  // was two identical GETs per location.
  // allow404: a channel someone deleted by hand is an ordinary state for a
  // blind sweep, not a reason to abandon it. Same reasoning, and the same
  // idiom, as db/lib/syncLocations.js and db/lib/locationAccess.js.
  const channel = await getChannel(location.discordPublicChannelId, { allow404: true });
  if (!channel) return;
  const tagId = (name) => channel.available_tags?.find((t) => t.name === name)?.id ?? null;
  const persistentTagId = tagId(PERSISTENT_TAG_NAME);
  const informationTagId = tagId(INFORMATION_TAG_NAME);
  const threads = await collectThreads(
    location.discordPublicChannelId,
    { public: true, private: false },
    activeSnapshot,
  );

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

async function wipePrivateChannel(location, activeSnapshot) {
  if (!location.discordPrivateChannelId) return;

  const threads = await collectThreads(
    location.discordPrivateChannelId,
    { public: false, private: true },
    activeSnapshot,
  );
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

  // Fetched ONCE for the whole wipe. The endpoint is guild-wide, and asking
  // per channel meant 30 identical full-guild fetches per run. A thread
  // created mid-wipe is missed until the next one, which is the same window
  // the per-channel version had anyway.
  const activeThreads = await fetchActiveThreads().catch((err) => {
    console.error("Dawn wipe: active-thread snapshot failed, falling back to per-channel fetches:", err);
    return null;
  });

  // Per-location, so one bad room costs one room.
  //
  // These were three bare awaits with no guard, so a single stale channel id —
  // a forum a GM deleted by hand, most likely — threw and aborted the loop for
  // every location after it alphabetically, AND the two narrowcast wipes
  // below. The only evidence was one line on stderr from the caller's catch,
  // which couldn't even say how far it got.
  const failures = [];
  for (const location of sorted) {
    if (!location.discordCategoryId) continue;
    const label = `${location.zone.name} / ${location.name}`;
    console.log(`Dawn wipe: ${label}`);
    try {
      await wipePlainChannel(location);
      await wipePublicForum(location, activeThreads);
      await wipePrivateChannel(location, activeThreads);
    } catch (err) {
      failures.push(label);
      console.error(`Dawn wipe: ${label} failed, continuing with the rest:`, err.message);
    }
  }

  for (const [label, channelId] of [
    ["Radio", config?.radioChannelId],
    ["Intercom", config?.intercomChannelId],
  ]) {
    console.log(`Dawn wipe: ${label}`);
    try {
      await wipeNarrowcastChannel(channelId);
    } catch (err) {
      failures.push(label);
      console.error(`Dawn wipe: ${label} failed:`, err.message);
    }
  }

  if (failures.length > 0) {
    console.error(`Dawn wipe finished with ${failures.length} failed: ${failures.join(", ")}.`);
  }
  return { failed: failures.length, failures };
}

module.exports = { runDawnWipe };
