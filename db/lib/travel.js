const { recordArchiveEvent } = require("./archive");
const { seatZoneIdFor } = require("./seatZone");
const { rollCaving } = require("./cavingPass");

// The database half of a zone change, shared by both faces of the game:
// bot/src/lib/zoneTravel.js#performMove (gateway) and
// web/app/(app)/map/travelActions.js#travelTo (REST). It validates the hop,
// writes the character's new zone and the auto-resolved Move that spends the
// turn — since the zone rework EVERY hop costs the Move; free same-zone
// travel went with the per-Location channels.
//
// It deliberately performs **no Discord side effects**, the same split
// advanceTurn()/runSideEffects() uses: the bot has a gateway client and the
// web app only has REST, so each caller runs its own twin of
// swapZoneRole/syncCharacterNarrowcastAccess/applyPendingInvites afterwards.
// `oldZone` comes back on the result precisely so they can.
//
// Arriving at a CAVE_LEVEL zone also rolls the Caving Die (the "on arrival"
// trigger — see db/lib/cavingPass.js and docs/systemdocs/CAVING.md). Same
// no-Discord discipline: the roll is written here, and `cavingDm` comes back
// on the result for the caller to send. The turn-start pass fires the other
// trigger every subsequent turn; @@unique([characterId, turnId]) on
// CavingRoll is what keeps the two from double-rolling a character who
// arrives and then the same turn closes under them.
//
// Legality: targetZone must be a presence zone (never the Caves group row)
// and a direct neighbour of where the character stands (Zone.connectsTo,
// mastered by docs/zones.yaml's zoneConnections). The adjacency gate is
// skipped entirely when the character has no zone yet, so a first-ever
// placement can go anywhere.
//
// Returns { ok: true, oldZone } or { ok: false, reason }.
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
  //
  // Two submissions at once — the #turns Travel button and the web map, or
  // two map clicks — used to both pass the acted-check and both move, while
  // @@unique([characterId, turnId]) let only one Action through: the player
  // ended up two hops away having spent one Move. Filing first makes the
  // unique constraint the gate: the loser's create raises P2002, which aborts
  // the transaction, and the move it would have made is rolled back with it.
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

  let cavingDm = null;
  if (targetZone.kind === "CAVE_LEVEL") {
    // `openTurn` is already loaded when this hop cost a Move; a free first
    // placement (a Migrant/Mercenary starting in the Depths) has none yet,
    // so fetch it. No open turn at all (mid-restart) just skips the roll —
    // the next turn's pass or the next arrival will catch them.
    const turnForRoll = openTurn ?? (await prisma.turn.findFirst({ where: { status: "OPEN" } }));
    if (turnForRoll) {
      const { dm } = await rollCaving(prisma, character, turnForRoll, targetZone).catch((err) => {
        console.error(`Caving arrival roll failed for character ${character.id}:`, err);
        return { dm: null };
      });
      cavingDm = dm;
    }
  }

  return { ok: true, oldZone: currentZone, cavingDm };
}

module.exports = { performTravel };
