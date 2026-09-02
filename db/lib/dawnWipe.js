// Dawn message wipe: called from db/index.js#advanceTurn() whenever the
// newly-opened turn's phase is DAWN and GameConfig.messageWipeEnabled is on.
// Per zone: clears #summary and #private, and clears the public forum per
// each post's PlayerThread row (persistent survives emptied; unrouted posts
// are adopted, not deleted). Every rule is bounded by a CUTOFF (the moment
// the turn advance's side effects began), so it can't eat its own push's
// #summary post or a message sent while the wipe is still walking there.
// Sequential, not Promise.all, to respect Discord's rate limits.
const { PERSISTENT_TAG_NAME, QUEST_TAG_NAME } = require("./persistence");
const { SPECIAL_CHANNELS } = require("./specialChannels");
const {
  fetchAllMessages,
  bulkDeleteMessages,
  clearThreadExceptStarter,
  listActiveThreadsForChannel,
  fetchActiveThreads,
  getChannel,
  patchThread,
  listArchivedPublicThreads,
  listArchivedPrivateThreads,
  deleteThread,
  snowflakeForTimestamp,
  messageTimestamp,
  beginRequestMetrics,
  readRequestMetrics,
} = require("./discordRest");

// The cutoff: one instant, expressed two ways. `before` is the synthetic
// snowflake handed to Discord's message cursor; `ms` is the same moment in
// milliseconds, for the thread ids we have to judge ourselves.
function buildCutoff(cutoffMs) {
  return { ms: cutoffMs, before: snowflakeForTimestamp(cutoffMs) };
}

// True for anything created after the wipe's cutoff. An id we can't parse is
// treated as old, which is the conservative read for a blind sweep: it stays
// under the ordinary rules rather than silently becoming immortal.
function isAfterCutoff(snowflakeId, cutoff) {
  const at = messageTimestamp(snowflakeId);
  return at !== null && at >= cutoff.ms;
}

async function clearMessages(channelOrThreadId, before) {
  const messages = await fetchAllMessages(channelOrThreadId, { before });
  if (messages.length === 0) return;
  await bulkDeleteMessages(
    channelOrThreadId,
    messages.map((m) => m.id),
  );
}

// Everything in a channel except one message, by id. Unlike
// clearThreadExceptStarter, a plain channel has no un-bulk-deletable starter
// to route around; this keeps one nominated message instead. Used by #turns'
// per-turn console repost (db/lib/turnAnnouncement.js), not the Dawn wipe
// itself: #turns runs this every turn, Dawn or Dusk, and isn't in
// SPECIAL_CHANNELS — so it takes no cutoff either.
async function clearMessagesExcept(channelId, keepId) {
  const messages = await fetchAllMessages(channelId);
  const toDelete = messages.filter((m) => m.id !== keepId).map((m) => m.id);
  if (toDelete.length === 0) return;
  await bulkDeleteMessages(channelId, toDelete);
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

async function wipeForum(prisma, zone, rowsByThreadId, topicThreadIds, activeSnapshot, cutoff) {
  if (!zone.discordPublicChannelId) return;

  // allow404: a channel someone deleted by hand is an ordinary state for a
  // blind sweep, not a reason to abandon it.
  const channel = await getChannel(zone.discordPublicChannelId, { allow404: true });
  if (!channel) return;
  const tagIdByName = (name) => channel.available_tags?.find((t) => t.name === name)?.id ?? null;
  const persistentTagId = tagIdByName(PERSISTENT_TAG_NAME);
  const questTagId = tagIdByName(QUEST_TAG_NAME);

  // Re-assert a mirror tag the DB says should be there. Best-effort: the DB
  // is the truth the wipe reads, so a failed PATCH costs a visual cue, not a
  // rule.
  const reassertTag = async (thread, tagId) => {
    if (!tagId || thread.applied_tags?.includes(tagId)) return;
    await patchThread(thread.id, {
      archived: false,
      applied_tags: [...(thread.applied_tags ?? []), tagId],
    }).catch((err) => console.error(`Dawn wipe: tag re-assert on ${thread.id} failed:`, err.message));
  };

  const threads = await collectThreads(
    zone.discordPublicChannelId,
    { public: true, private: false },
    activeSnapshot,
  );

  for (const thread of threads) {
    if (thread.id === zone.createTopicThreadId) continue;

    if (topicThreadIds.has(thread.id)) {
      await clearThreadExceptStarter(thread.id, { before: cutoff.before });
      continue;
    }

    // A thread younger than the cutoff was opened while this very wipe was
    // running. Leave it entirely — deleting it would destroy a post whose
    // author is still looking at it. It comes under the ordinary rules next
    // Dawn, exactly like an adopted thread.
    if (isAfterCutoff(thread.id, cutoff)) continue;

    let row = rowsByThreadId.get(thread.id);
    if (!row) row = await adoptThread(prisma, thread, zone, "PUBLIC");
    // Checked before `persistent`: a Quest row carries both, and this is the
    // stronger of the two.
    if (row?.keepStarter) {
      await clearThreadExceptStarter(thread.id, { before: cutoff.before });
      await reassertTag(thread, questTagId);
    } else if (row?.persistent) {
      await clearMessages(thread.id, cutoff.before);
      // Re-assert the mirror: the DB said it survives, so the tag should say
      // so too, whatever a hand-edit did to it.
      await reassertTag(thread, persistentTagId);
    } else {
      await deletePlayerThread(prisma, thread.id);
    }
  }
}

async function wipePrivateChannel(prisma, zone, rowsByThreadId, activeSnapshot, cutoff) {
  if (!zone.discordPrivateChannelId) return;

  const threads = await collectThreads(
    zone.discordPrivateChannelId,
    { public: false, private: true },
    activeSnapshot,
  );
  for (const thread of threads) {
    if (isAfterCutoff(thread.id, cutoff)) continue;

    let row = rowsByThreadId.get(thread.id);
    if (!row) row = await adoptThread(prisma, thread, zone, "PRIVATE");
    if (row?.persistent) {
      await clearMessages(thread.id, cutoff.before);
    } else {
      await deletePlayerThread(prisma, thread.id);
    }
  }
}

// `cutoffMs` is the moment the turn advance's side effects began — see
// db/index.js#runSideEffects and the CUTOFF rule in the file header above.
// Defaults to "now" so a hand-run wipe still can't eat its own tail.
async function runDawnWipe(prisma, { cutoffMs = Date.now() } = {}) {
  const startedAt = Date.now();
  const cutoff = buildCutoff(cutoffMs);
  const steps = [];

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

  // Each step is timed and counted, and lands in the SystemReport below. The
  // wipe is the longest thing the bot does and nobody could say which part of
  // it was the slow part; a per-zone request count answers that from the Dev
  // Panel instead of from a stopwatch.
  const timeStep = async (name, fn) => {
    const at = Date.now();
    const metrics = beginRequestMetrics();
    let ok = true;
    try {
      await fn();
    } catch (err) {
      ok = false;
      throw err;
    } finally {
      steps.push({ name, ok, elapsedMs: Date.now() - at, ...readRequestMetrics(metrics) });
    }
  };

  for (const zone of zones) {
    console.log(`Dawn wipe: ${zone.name}`);
    try {
      await timeStep(zone.name, async () => {
        if (zone.discordSummaryChannelId) await clearMessages(zone.discordSummaryChannelId, cutoff.before);
        await wipeForum(prisma, zone, rowsByThreadId, topicThreadIds, activeThreads, cutoff);
        await wipePrivateChannel(prisma, zone, rowsByThreadId, activeThreads, cutoff);
      });
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
      await timeStep(`#${entry.slug}`, () => clearMessages(channelId, cutoff.before));
    } catch (err) {
      failures.push({ step: "special", target: entry.slug, message: err.message });
      console.error(`Dawn wipe: #${entry.slug} failed:`, err.message);
    }
  }

  if (failures.length > 0) {
    console.error(`Dawn wipe finished with ${failures.length} failures.`);
  }

  const elapsedMs = Date.now() - startedAt;
  console.log(
    `Dawn wipe finished in ${Math.round(elapsedMs / 1000)}s over ` +
      `${steps.reduce((n, step) => n + step.requests, 0)} Discord requests.`,
  );

  await prisma.systemReport
    .create({
      data: {
        kind: "DAWN_WIPE",
        startedAt: new Date(startedAt),
        finishedAt: new Date(),
        ok: failures.length === 0,
        summary: {
          zones: zones.length,
          elapsedMs,
          requests: steps.reduce((n, step) => n + step.requests, 0),
          sleepMs: steps.reduce((n, step) => n + step.sleepMs, 0),
          retries: steps.reduce((n, step) => n + step.retries, 0),
          cutoff: new Date(cutoff.ms).toISOString(),
          steps,
        },
        failures,
      },
    })
    .catch((err) => console.error("Dawn wipe: report write failed:", err.message));

  return { failed: failures.length, failures };
}

module.exports = { runDawnWipe, clearMessagesExcept };
