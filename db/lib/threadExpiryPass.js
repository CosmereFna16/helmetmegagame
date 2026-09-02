// Inactivity expiry for player-made topics and private threads: any
// PlayerThread with no messages for THREAD_EXPIRY_TURNS turns is deleted,
// thread, row and invites. Called from advanceTurn()'s side-effect thunk on
// every DAWN, after the Dawn wipe has already cleared non-persistent
// threads — this pass only ages out the persistent: true ones.
//
// The clock is TURNS, not wall time, tracked on PlayerThread.lastActivityTurn
// since a persistent thread's messages are emptied nightly. Before deleting,
// this cross-checks Discord's last_message_id so a message the bot missed
// while disconnected still counts.
const { getChannel, messageTimestamp, deleteThread } = require("./discordRest");

const THREAD_EXPIRY_TURNS = 5;

// The turn whose span contains `date` — the newest turn that had started by
// then. One query, and only run for threads already past the cutoff.
async function turnNumberAt(prisma, date) {
  const turn = await prisma.turn.findFirst({
    where: { startedAt: { lte: date } },
    orderBy: { startedAt: "desc" },
    select: { number: true },
  });
  return turn?.number ?? null;
}

async function runThreadExpiry(prisma, openTurn) {
  if (!openTurn) return { expired: [], failures: [] };

  const cutoff = openTurn.number - THREAD_EXPIRY_TURNS;

  const rows = await prisma.playerThread.findMany();
  const expired = [];
  const failures = [];

  for (const row of rows) {
    // A row with no recorded turn falls back to its creation moment.
    let lastTurn = row.lastActivityTurn;
    if (lastTurn === null) {
      lastTurn = await turnNumberAt(prisma, row.createdAt);
      if (lastTurn === null) continue; // pre-turn-1 edge; let it live
    }
    if (lastTurn > cutoff) continue;

    // Past the cutoff on our books — verify against Discord before deleting.
    // The thread object's last_message_id is the ground truth for messages
    // the bot never saw.
    let thread = null;
    try {
      thread = await getChannel(row.threadId, { allow404: true });
    } catch (err) {
      failures.push({ step: "expiry-read", target: row.name, message: err.message });
      continue;
    }
    if (!thread) {
      // Already gone from Discord — just clean the books.
      await prisma.playerThread.deleteMany({ where: { threadId: row.threadId } }).catch(() => {});
      await prisma.playerThreadInvite.deleteMany({ where: { threadId: row.threadId } }).catch(() => {});
      continue;
    }

    const lastMessageMs = thread.last_message_id ? messageTimestamp(thread.last_message_id) : null;
    const lastMessageAt = lastMessageMs ? new Date(lastMessageMs) : null;
    if (lastMessageAt && lastMessageAt > row.lastActivityAt) {
      const realTurn = await turnNumberAt(prisma, lastMessageAt);
      await prisma.playerThread
        .update({
          where: { id: row.id },
          data: { lastActivityAt: lastMessageAt, lastActivityTurn: realTurn ?? lastTurn },
        })
        .catch(() => {});
      if ((realTurn ?? lastTurn) > cutoff) continue;
    }

    try {
      await deleteThread(row.threadId);
      await prisma.playerThread.deleteMany({ where: { threadId: row.threadId } });
      await prisma.playerThreadInvite.deleteMany({ where: { threadId: row.threadId } });
      expired.push({ name: row.name, kind: row.kind, zoneId: row.zoneId });
      console.log(`Thread expiry: removed "${row.name}" (idle since turn ${lastTurn}).`);
    } catch (err) {
      failures.push({ step: "expiry-delete", target: row.name, message: err.message });
      console.error(`Thread expiry: failed to remove "${row.name}":`, err.message);
    }
  }

  return { expired, failures };
}

module.exports = { runThreadExpiry };
