const { recordArchiveEvent } = require("./archive");
const { seatZoneIdFor } = require("./seatZone");
const { rollCavingOnArrival } = require("./cavingPass");

// The database half of a zone change, shared by bot/src/lib/zoneTravel.js
// #performMove (gateway) and web/app/(app)/map/travelActions.js#travelTo
// (REST). It validates the hop and writes the character's new zone plus the
// auto-resolved Move that spends the turn — every hop costs a Move, except a
// character's first-ever placement, which is free. It performs **no Discord
// side effects**; each caller runs its own role/access sync afterward using
// `oldZone` from the result. Arriving at a CAVE_LEVEL also rolls the Caving
// Die (db/lib/cavingPass.js); `cavingDm` comes back for the caller to send.
// Legality: targetZone must be a presence zone and a direct neighbour
// (Zone.connectsTo), unless the character has no zone yet.
async function performTravel(prisma, character, targetZone) {
  if (targetZone.kind === "CAVE_GROUP") {
    return { ok: false, reason: "That isn't a place you can stand." };
  }

  let currentZone = null;
  if (character.zoneId) {
    if (character.zoneId === targetZone.id) {
      return { ok: false, reason: "You're already there." };
    }
    currentZone = await prisma.zone.findUnique({
      where: { id: character.zoneId },
      include: { connectsTo: { where: { id: targetZone.id } } },
    });
    if (!currentZone || currentZone.connectsTo.length === 0) {
      return { ok: false, reason: "You can't get there directly from here." };
    }
  }

  // A first placement (no current zone) is free — it isn't travel, it's
  // arrival. Everything else files the Move.
  const free = !currentZone;

  let openTurn = null;
  if (!free) {
    openTurn = await prisma.turn.findFirst({ where: { status: "OPEN" } });
    if (!openTurn) return { ok: false, reason: "No turn is currently open." };
  }

  // One transaction, and the Action is written BEFORE the character moves.
  // Two submissions at once (the #turns Travel button and the web map, or
  // two map clicks) must not both move the character while
  // @@unique([characterId, turnId]) lets only one Action through. Filing
  // first makes the unique constraint the gate: the loser's create raises
  // P2002, which aborts the transaction and rolls back the move with it.
  try {
    await prisma.$transaction(async (tx) => {
      if (!free) {
        // The same check the Move modal makes in reverse: acting and
        // changing zones are mutually exclusive within a turn, in either
        // order. This one is for the message; P2002 below is the enforcement.
        const existing = await tx.action.findFirst({
          where: { characterId: character.id, turnId: openTurn.id },
        });
        if (existing) throw Object.assign(new Error("ALREADY_ACTED"), { code: "ALREADY_ACTED" });

        await tx.action.create({
          data: {
            characterId: character.id,
            turnId: openTurn.id,
            type: "MOVE",
            status: "CONFIRMED",
            moveReviewStatus: "SOLVED",
            description: `Traveled to ${targetZone.name}.`,
            // The SEAT zone, not the presence zone — a Move filed from the
            // Railroad belongs on the Caves GM's table.
            zoneId: seatZoneIdFor(targetZone),
            resultMessage: `» Traveled to ${targetZone.name}.`,
            gmNotes: "auto:zone_change",
          },
        });
      }

      await tx.character.update({
        where: { id: character.id },
        data: { zoneId: targetZone.id },
      });
    });
  } catch (err) {
    if (err.code === "ALREADY_ACTED" || err.code === "P2002") {
      return { ok: false, reason: "You've already acted this turn." };
    }
    throw err;
  }

  // Off by default (see GameConfig.archiveTravelEvents): arrivals are what
  // make a zone read like a story, and also two rows per character per turn
  // before anyone says a word.
  const config = await prisma.gameConfig.findUnique({
    where: { id: 1 },
    select: { archiveTravelEvents: true },
  });
  if (config?.archiveTravelEvents) {
    await recordArchiveEvent(prisma, {
      kind: "TRAVEL",
      character,
      zoneId: targetZone.id,
      zoneName: targetZone.name,
      content: currentZone
        ? `${character.name} left ${currentZone.name} for ${targetZone.name}.`
        : `${character.name} arrived at ${targetZone.name}.`,
    });
  }

  // The arrival trigger, shared with the raw GM relocations (the Dev Panel's
  // zone edit, Bulk Move) so every way into the Depths rolls the same die.
  // Zone kind, the open turn and error swallowing all live in the helper.
  const cavingDm = await rollCavingOnArrival(prisma, character, targetZone);

  return { ok: true, oldZone: currentZone, cavingDm };
}

module.exports = { performTravel };
