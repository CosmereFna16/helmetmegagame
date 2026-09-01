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
//       * a Quest post (PlayerThread.keepStarter) — a GM's hand-made post,
//         re-authored as the bot by bot/src/lib/questPost.js. Treated exactly
//         like a Location topic here: every message deleted EXCEPT the
//         starter. It is never deleted by this pass; a GM removes it by hand
//         (or inactivity expiry ages it out). Its Quest tag is re-asserted,
//         same reasoning as Persistent below.
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
// Every one of those rules is bounded by a CUTOFF: the moment the turn
// advance's side effects began. Nothing newer is touched, in any target. That
// single rule is what stops the wipe deleting the staged adjudication and the
// Default Move summaries that the same push posted to #summary seconds
// earlier, and what protects a player who posts while the wipe — which takes
// a long time — is still walking toward their zone. It needs no exemption
// list, because a Discord snowflake already carries its own creation time.
//
// The transcript is recorded at send time (db/lib/archive.js), so this file
// only deletes. Entirely sequential (no Promise.all fan-out) to avoid
// bursting Discord's rate-limit buckets. Per-zone try/catch, so one bad room
// costs one room. The whole run is persisted as a SystemReport row
// (kind: DAWN_WIPE) — the Dev Panel shows it instead of guessing.
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
// db/index.js#runSideEffects. Nothing created at or after it is touched, which
// is what keeps the wipe from eating the staged adjudication and the Default
// Move summaries the same push just posted, and what keeps a player's message
// safe if they send it while the (long) wipe is still walking toward their
// zone. Defaults to "now" so a hand-run wipe still can't eat its own tail.
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
