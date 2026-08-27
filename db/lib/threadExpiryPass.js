// Inactivity expiry for player-made topics and private threads: any
// PlayerThread — persistent or not — with no messages for
// GameConfig.threadExpiryTurns turns is deleted, thread, row and invites.
// Location topics and the anchor posts have no PlayerThread row, so they are
// structurally exempt; there is no exclusion list to keep in sync.
//
// Called from advanceTurn()'s side-effect thunk on every DAWN, gated on
// GameConfig.threadExpiryEnabled — deliberately independent of
// messageWipeEnabled, so a game that never wipes can still reap dead scenes.
//
// The clock is TURNS, not wall time, and it survives the Dawn wipe on the
// row even though a persistent thread is emptied by it (which is the single
// reason PlayerThread.lastActivityTurn exists — "no messages for N turns"
// cannot be read out of a thread that gets emptied nightly). The bot's
// messageCreate writes it live; before deleting anything this pass
// cross-checks the thread's last_message_id snowflake, so a message the bot
// missed while disconnected still counts.
const { getChannel, messageTimestamp, deleteThread } = require("./discordRest");

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
  const config = await prisma.gameConfig.findUnique({ where: { id: 1 } });
  if (!config?.threadExpiryEnabled || !openTurn) return { expired: [], failures: [] };

  const limit = Math.max(1, config.threadExpiryTurns ?? 5);
  const cutoff = openTurn.number - limit;

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
