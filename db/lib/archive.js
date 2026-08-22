// Writes the game transcript (ArchiveEntry), the store behind /archive.
//
// Rows are recorded at SEND time rather than reconstructed at Dawn. The old
// db/lib/dawnWipe.js archived by reading every message back out of Discord and
// re-posting it into a single #archive channel — hundreds of sequential posts
// down one ~1 msg/sec lane, the most expensive thing the bot did, and it grew
// with player count. It also had to guess at two fields it can now be told
// outright: the character (matched by *current* name, so a rename
// mis-attributed everything they had ever said) and the turn (inferred by
// comparing timestamps against Turn.gameDate).
//
// Takes `prisma` as a parameter rather than require("../index"), same reason
// as dm.js and turnAnnouncement.js: db/index.js imports this module, so
// requiring it back would resolve to a partial (prisma-less) exports object.
// Deliberately NOT spread into the @lifeweb/db barrel — require it by path.

// Every write here is best-effort and swallows its own failure. A transcript
// row is never worth breaking a player's message over, and the proxy path
// calls this inline with the send. Failures are logged, not thrown.
async function safely(label, fn) {
  try {
    return await fn();
  } catch (err) {
    console.error(`Archive ${label} failed:`, err);
    return null;
  }
}

// The open turn, so a row can be stamped with when it happened in the fiction.
// Callers that already hold the turn (advanceTurn, the Default Move pass) pass
// it in to skip the lookup.
async function resolveTurn(prisma, turn) {
  if (turn) return turn;
  return prisma.turn.findFirst({ where: { status: "OPEN" } });
}

// One proxied character message. `concealedAlias` is non-null only for a
// /conceal send — both halves are kept, since the panel renders
// "Young Man (Sir Alder)": the alias is what the room saw, characterName is
// who it actually was.
async function recordArchiveMessage(prisma, entry) {
  return safely("message write", async () => {
    const turn = await resolveTurn(prisma, entry.turn);
    return prisma.archiveEntry.create({
      data: {
        kind: "MESSAGE",
        turnNumber: turn?.number ?? null,
        turnPhase: turn?.phase ?? null,
        sentAt: entry.sentAt ?? new Date(),
        locationId: entry.locationId ?? null,
        locationName: entry.locationName ?? null,
        characterId: entry.character?.id ?? null,
        characterName: entry.character?.name ?? null,
        concealedAlias: entry.concealedAlias ?? null,
        content: entry.content ?? "",
        discordMessageId: entry.discordMessageId ?? null,
        channelKind: entry.channelKind ?? null,
        threadName: entry.threadName ?? null,
      },
    });
  });
}

// A system event — a turn opening, a death, a fulfilled Desire. Same table as
// messages so the two interleave chronologically and the transcript reads as a
// diary rather than a chat log with no context.
async function recordArchiveEvent(prisma, entry) {
  return safely(`${entry.kind} write`, async () => {
    const turn = await resolveTurn(prisma, entry.turn);
    return prisma.archiveEntry.create({
      data: {
        kind: entry.kind,
        turnNumber: turn?.number ?? null,
        turnPhase: turn?.phase ?? null,
        sentAt: entry.sentAt ?? new Date(),
        locationId: entry.locationId ?? null,
        locationName: entry.locationName ?? null,
        characterId: entry.character?.id ?? entry.characterId ?? null,
        characterName: entry.character?.name ?? entry.characterName ?? null,
        content: entry.content ?? "",
      },
    });
  });
}

// ✏️ edited a proxied message. Keyed on the Discord message id, so a row the
// bot no longer has in its in-memory recentProxies map is simply not found —
// which matches Discord, where that message is already inert to reactions.
async function updateArchiveMessage(prisma, discordMessageId, content) {
  return safely("message edit", () =>
    prisma.archiveEntry.updateMany({ where: { discordMessageId }, data: { content } }),
  );
}

// ❌ deleted a proxied message. Delete means gone: the transcript honors it,
// so a player can trust the button. The cost is that the record is incomplete
// and someone can quietly retract what they said.
async function deleteArchiveMessage(prisma, discordMessageId) {
  return safely("message delete", () => prisma.archiveEntry.deleteMany({ where: { discordMessageId } }));
}

module.exports = {
  recordArchiveMessage,
  recordArchiveEvent,
  updateArchiveMessage,
  deleteArchiveMessage,
};
