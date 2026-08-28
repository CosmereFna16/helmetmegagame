// Debounced writer for Character.lastActivityTurn — the clock
// db/lib/catatonicPass.js reads. Same shape and same reasoning as
// touchThreadActivity in bot/src/events/messageCreate.js for
// PlayerThread.lastActivityTurn: looks up the open turn itself so call sites
// only need a characterId, and the `not: turnNumber` guard on the write means
// a chatty player costs one UPDATE per turn, not one per message, without
// needing an in-memory cache that a restart would just lose.
//
// Deliberately called only from the places that mean "a real person did
// something this turn": a proxied or /speak in-character message, and a
// player-filed Action. Never from db/lib/defaultMovePass.js — a saved
// Default Effort files an Action every turn on its own, and counting that
// would mean nobody with one could ever go Catatonic, which defeats the tag.
//
// Takes `prisma` as a parameter — see db/lib/dm.js for why.
async function touchCharacterActivity(prisma, characterId) {
  if (!characterId) return;
  const openTurn = await prisma.turn.findFirst({ where: { status: "OPEN" }, select: { number: true } });
  if (!openTurn) return; // between turns; the next activity after open catches up
  await prisma.character
    .updateMany({
      where: { id: characterId, lastActivityTurn: { not: openTurn.number } },
      data: { lastActivityTurn: openTurn.number },
    })
    .catch((err) => console.error(`touchCharacterActivity failed for ${characterId}:`, err));
}

module.exports = { touchCharacterActivity };
