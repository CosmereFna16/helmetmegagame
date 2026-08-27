// Dawn message wipe: called from db/index.js#advanceTurn() whenever the
// newly-opened turn's phase is DAWN and GameConfig.messageWipeEnabled is on.
// Per zone (cave levels included):
//   - #summary: every message deleted.
//   - the public forum's posts, by what each post IS:
//       * the zone's Create-a-Topic anchor — untouched, the wipe does not
//         reach in there at all.
//       * a generated Location topic (LocationTopic.discordThreadId) — every
//         message deleted EXCEPT the starter, whose id is the thread's own
//         id; the location's prose is the post's whole value.
//       * a player topic — its PlayerThread row decides: persistent rows
//         survive but are emptied (and get their Persistent tag re-asserted,
//         since the DB is the truth and the tag only a mirror); the rest are
//         deleted, row and invites included.
//       * a post with NO row — adopted: a row is written (persistent: false)
//         rather than the post silently destroyed, so a GM's hand-made post
//         gets one full turn and a visible record instead of vanishing on
//         the first wipe after it appears.
//   - #private threads: same PlayerThread rule; there is no visible marker
//     at all (the ⏰ name-prefix era is over). Surviving keeps the thread's
//     member list, which is the practical point of persistence there.
// Then every special-channel registry entry with wipe: "clear".
//
// The transcript is recorded at send time (db/lib/archive.js), so this file
// only deletes. Entirely sequential (no Promise.all fan-out) to avoid
// bursting Discord's rate-limit buckets. Per-zone try/catch, so one bad room
// costs one room. The whole run is persisted as a SystemReport row
// (kind: DAWN_WIPE) — the Dev Panel shows it instead of guessing.
const { PERSISTENT_TAG_NAME } = require("./persistence");
const { SPECIAL_CHANNELS } = require("./specialChannels");
const {
  fetchAllMessages,
  bulkDeleteMessages,
  listActiveThreadsForChannel,
  fetchActiveThreads,
  getChannel,
  patchThread,
  deleteMessage,
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

// Everything except the starter message, whose id IS the thread id — deleting
// that one destroys the whole post. Same guard the sync's rebuild uses.
async function clearMessagesExceptStarter(threadId) {
  const messages = await fetchAllMessages(threadId);
  for (const message of messages) {
    if (message.id === threadId) continue;
    await deleteMessage(threadId, message.id);
  }
}

async function collectThreads(channelId, { public: includePublic, private: includePrivate }, activeSnapshot) {
  const active = await listActiveThreadsForChannel(channelId, activeSnapshot);
  const archivedPublic = includePublic ? await listArchivedPublicThreads(channelId) : [];
  const archivedPrivate = includePrivate ? await listArchivedPrivateThreads(channelId) : [];

  const byId = new Map();
  for (const thread of [...active, ...archivedPublic, ...archivedPrivate]) byId.set(thread.id, thread);
  return [...byId.values()];
}

// Adopt a thread the DB doesn't know: write the row rather than delete the
// thread. First seen at the wipe after it appears, so it always survives one
// turn — and from then on it lives under the ordinary rules.
async function adoptThread(prisma, thread, zone, kind) {
  return prisma.playerThread
    .create({
      data: {
        threadId: thread.id,
        kind,
        name: thread.name ?? "thread",
        zoneId: zone.id,
        persistent: false,
      },
    })
    .catch((err) => {
      console.error(`Dawn wipe: couldn't adopt thread ${thread.id}:`, err.message);
      return null;
    });
}

async function deletePlayerThread(prisma, threadId) {
  await deleteThread(threadId);
  await prisma.playerThread.deleteMany({ where: { threadId } }).catch(() => {});
  await prisma.playerThreadInvite.deleteMany({ where: { threadId } }).catch(() => {});
}

async function wipeForum(prisma, zone, rowsByThreadId, topicThreadIds, activeSnapshot) {
  if (!zone.discordPublicChannelId) return;

  // allow404: a channel someone deleted by hand is an ordinary state for a
  // blind sweep, not a reason to abandon it.
  const channel = await getChannel(zone.discordPublicChannelId, { allow404: true });
  if (!channel) return;
  const persistentTagId = channel.available_tags?.find((t) => t.name === PERSISTENT_TAG_NAME)?.id ?? null;

  const threads = await collectThreads(
    zone.discordPublicChannelId,
    { public: true, private: false },
    activeSnapshot,
  );

  for (const thread of threads) {
    if (thread.id === zone.createTopicThreadId) continue;

    if (topicThreadIds.has(thread.id)) {
      await clearMessagesExceptStarter(thread.id);
      continue;
    }

    let row = rowsByThreadId.get(thread.id);
    if (!row) row = await adoptThread(prisma, thread, zone, "PUBLIC");
    if (row?.persistent) {
      await clearMessages(thread.id);
      // Re-assert the mirror: the DB said it survives, so the tag should say
      // so too, whatever a hand-edit did to it.
      if (persistentTagId && !thread.applied_tags?.includes(persistentTagId)) {
        await patchThread(thread.id, {
          archived: false,
          applied_tags: [...(thread.applied_tags ?? []), persistentTagId],
        }).catch((err) => console.error(`Dawn wipe: tag re-assert on ${thread.id} failed:`, err.message));
      }
    } else {
      await deletePlayerThread(prisma, thread.id);
    }
  }
}

async function wipePrivateChannel(prisma, zone, rowsByThreadId, activeSnapshot) {
  if (!zone.discordPrivateChannelId) return;

  const threads = await collectThreads(
    zone.discordPrivateChannelId,
    { public: false, private: true },
    activeSnapshot,
  );
  for (const thread of threads) {
    let row = rowsByThreadId.get(thread.id);
    if (!row) row = await adoptThread(prisma, thread, zone, "PRIVATE");
    if (row?.persistent) {
      await clearMessages(thread.id);
    } else {
      await deletePlayerThread(prisma, thread.id);
    }
  }
}

async function runDawnWipe(prisma) {
  const [zones, config, topics, playerThreads] = await Promise.all([
    prisma.zone.findMany({
      where: { kind: { not: "CAVE_GROUP" } },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    }),
    prisma.gameConfig.findUnique({ where: { id: 1 } }),
    prisma.locationTopic.findMany({ select: { discordThreadId: true } }),
    prisma.playerThread.findMany(),
  ]);
  const topicThreadIds = new Set(topics.map((t) => t.discordThreadId).filter(Boolean));
  const rowsByThreadId = new Map(playerThreads.map((row) => [row.threadId, row]));

  // Fetched ONCE for the whole wipe — the endpoint is guild-wide. A thread
  // created mid-wipe is missed until the next one, same as always.
  const activeThreads = await fetchActiveThreads().catch((err) => {
    console.error("Dawn wipe: active-thread snapshot failed, falling back to per-channel fetches:", err);
    return null;
  });

  const failures = [];
  for (const zone of zones) {
    console.log(`Dawn wipe: ${zone.name}`);
    try {
      if (zone.discordSummaryChannelId) await clearMessages(zone.discordSummaryChannelId);
      await wipeForum(prisma, zone, rowsByThreadId, topicThreadIds, activeThreads);
      await wipePrivateChannel(prisma, zone, rowsByThreadId, activeThreads);
    } catch (err) {
      failures.push({ step: "zone", target: zone.name, message: err.message });
      console.error(`Dawn wipe: ${zone.name} failed, continuing with the rest:`, err.message);
    }
  }

  for (const entry of SPECIAL_CHANNELS) {
    if (entry.wipe !== "clear") continue;
    const channelId = config?.[entry.configKey];
    if (!channelId) continue;
    console.log(`Dawn wipe: #${entry.slug}`);
    try {
      await clearMessages(channelId);
    } catch (err) {
      failures.push({ step: "special", target: entry.slug, message: err.message });
      console.error(`Dawn wipe: #${entry.slug} failed:`, err.message);
    }
  }

  if (failures.length > 0) {
    console.error(`Dawn wipe finished with ${failures.length} failures.`);
  }

  await prisma.systemReport
    .create({
      data: {
        kind: "DAWN_WIPE",
        finishedAt: new Date(),
        ok: failures.length === 0,
        summary: { zones: zones.length },
        failures,
      },
    })
    .catch((err) => console.error("Dawn wipe: report write failed:", err.message));

  return { failed: failures.length, failures };
}

module.exports = { runDawnWipe };
