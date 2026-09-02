// Dawn message wipe: called from db/index.js#advanceTurn() whenever the
// newly-opened turn's phase is DAWN and GameConfig.messageWipeEnabled is on.
// Per zone: clears #summary; per location: clears the channel down to its
// pinned anchor, empties every Room thread down to its starter, and deletes
// every Conversation outright (there is no persistence any more). Every rule
// is bounded by a CUTOFF (the moment the turn advance's side effects began),
// so it can't eat its own push's #summary post or a message sent while the
// wipe is still walking there. Sequential, not Promise.all, to respect
// Discord's rate limits.
const { SPECIAL_CHANNELS } = require("./specialChannels");
const {
  fetchAllMessages,
  bulkDeleteMessages,
  clearMessagesExcept,
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

async function collectThreads(channelId, activeSnapshot) {
  const active = await listActiveThreadsForChannel(channelId, activeSnapshot);
  const archivedPublic = await listArchivedPublicThreads(channelId);
  const archivedPrivate = await listArchivedPrivateThreads(channelId);

  const byId = new Map();
  for (const thread of [...active, ...archivedPublic, ...archivedPrivate]) byId.set(thread.id, thread);
  return [...byId.values()];
}

// Adopt a thread the DB doesn't know: write the row rather than delete the
// thread. First seen at the wipe after it appears, so it always survives one
// turn — and from then on it lives under the ordinary rules.
async function adoptThread(prisma, thread, location) {
  return prisma.playerThread
    .create({
      data: {
        threadId: thread.id,
        name: thread.name ?? "thread",
        locationId: location.id,
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

async function wipeLocation(prisma, location, roomsByThreadId, rowsByThreadId, activeSnapshot, cutoff) {
  if (!location.discordChannelId) return;

  // allow404: a channel someone deleted by hand is an ordinary state for a
  // blind sweep, not a reason to abandon it.
  const channel = await getChannel(location.discordChannelId, { allow404: true });
  if (!channel) return;

  // The open street: everything but the pinned anchor.
  await clearMessagesExcept(location.discordChannelId, location.anchorMessageId, { before: cutoff.before });

  const threads = await collectThreads(location.discordChannelId, activeSnapshot);
  for (const thread of threads) {
    const room = roomsByThreadId.get(thread.id);
    if (room) {
      await clearMessagesExcept(thread.id, room.starterMessageId, { before: cutoff.before });
      // A room that idled into the archive comes back at Dawn.
      if (thread.thread_metadata?.archived) {
        await patchThread(thread.id, { archived: false }).catch((err) =>
          console.error(`Dawn wipe: unarchive of room ${room.name} failed:`, err.message),
        );
      }
      continue;
    }

    // A thread younger than the cutoff was opened while this very wipe was
    // running. Leave it entirely — deleting it would destroy a conversation
    // whose author is still looking at it. It comes under the ordinary rules
    // next Dawn, exactly like an adopted thread.
    if (isAfterCutoff(thread.id, cutoff)) continue;

    let row = rowsByThreadId.get(thread.id);
    if (!row) {
      row = await adoptThread(prisma, thread, location);
      continue;
    }
    await deletePlayerThread(prisma, thread.id);
  }
}

// `cutoffMs` is the moment the turn advance's side effects began — see
// db/index.js#runSideEffects and the CUTOFF rule in the file header above.
// Defaults to "now" so a hand-run wipe still can't eat its own tail.
async function runDawnWipe(prisma, { cutoffMs = Date.now() } = {}) {
  const startedAt = Date.now();
  const cutoff = buildCutoff(cutoffMs);
  const steps = [];

  const [zones, config, rooms, playerThreads] = await Promise.all([
    prisma.zone.findMany({
      where: { kind: { not: "CAVE_GROUP" } },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      include: { locations: { orderBy: { sortOrder: "asc" } } },
    }),
    prisma.gameConfig.findUnique({ where: { id: 1 } }),
    prisma.room.findMany({ where: { discordThreadId: { not: null } } }),
    prisma.playerThread.findMany(),
  ]);
  const roomsByThreadId = new Map(rooms.map((r) => [r.discordThreadId, r]));
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
  // it was the slow part; a per-location request count answers that from the
  // Dev Panel instead of from a stopwatch.
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

  let locationCount = 0;
  for (const zone of zones) {
    console.log(`Dawn wipe: ${zone.name}`);
    if (zone.discordSummaryChannelId) {
      try {
        await timeStep(`${zone.name} / summary`, () => clearMessages(zone.discordSummaryChannelId, cutoff.before));
      } catch (err) {
        failures.push({ step: "summary", target: zone.name, message: err.message });
        console.error(`Dawn wipe: ${zone.name} #summary failed, continuing:`, err.message);
      }
    }
    // Each location inside its own try, so one stale channel id costs one
    // room rather than every room after it.
    for (const location of zone.locations) {
      locationCount += 1;
      try {
        await timeStep(`${zone.name} / ${location.name}`, () =>
          wipeLocation(prisma, location, roomsByThreadId, rowsByThreadId, activeThreads, cutoff),
        );
      } catch (err) {
        failures.push({ step: "location", target: `${zone.name} / ${location.name}`, message: err.message });
        console.error(`Dawn wipe: ${location.name} failed, continuing with the rest:`, err.message);
      }
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
          locations: locationCount,
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
