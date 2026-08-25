const { isTravelFree } = require("./travelCost");
const { recordArchiveEvent } = require("./archive");

// The database half of a location change, shared by both faces of the game:
// bot/src/lib/location.js#performMove (gateway) and
// web/app/(app)/map/travelActions.js#travelTo (REST). It validates the hop,
// writes the character's new location and — when the hop isn't free — the
// auto-resolved Move that spends the turn.
//
// It deliberately performs **no Discord side effects**, the same split
// advanceTurn()/runSideEffects() uses: the bot has a gateway client and the
// web app only has REST, so each caller runs its own twin of
// swapLocationAccess/syncCharacterNarrowcastAccess afterwards. `oldLocation`
// comes back on the result precisely so they can.
//
// Legality and cost are two independent gates:
//  - legality: targetLocation must be a direct neighbour of where the
//    character stands (Location.connectsTo, mastered by
//    docs/locations.yaml's locationConnections). Skipped entirely when the
//    character has no Location yet, so a first-ever placement can go
//    anywhere.
//  - cost: see isTravelFree in ./travelCost — same zone is free, except
//    inside the Depths, where every level is its own Move.
//
// Returns { ok: true, free, oldLocation } or { ok: false, reason }.
async function performTravel(prisma, character, targetLocation) {
  let currentLocation = null;
  if (character.locationId) {
    currentLocation = await prisma.location.findUnique({
      where: { id: character.locationId },
      include: { connectsTo: { where: { id: targetLocation.id } } },
    });
    if (!currentLocation || currentLocation.connectsTo.length === 0) {
      return { ok: false, reason: "You can't get there directly from here." };
    }
  }

  // The location's own zone, not Character.zoneId. The mirror can be null on a
  // sheet the location isn't (ARCHITECTURE.md §6), and web/app/(app)/map's
  // node colouring already asks the question this way — so reading it off the
  // location is both more correct and the thing that keeps the map and the
  // server from disagreeing.
  const free = isTravelFree({
    fromSlug: currentLocation?.slug ?? null,
    fromZoneId: currentLocation?.zoneId ?? null,
    toSlug: targetLocation.slug ?? null,
    toZoneId: targetLocation.zoneId,
  });

  let openTurn = null;
  if (!free) {
    openTurn = await prisma.turn.findFirst({ where: { status: "OPEN" } });
    if (!openTurn) return { ok: false, reason: "No turn is currently open." };
  }

  // One transaction, and the Action is written BEFORE the character moves.
  //
  // These used to be three bare statements on the raw client: check whether
  // they had acted, move them, then file the Action. Two submissions at once —
  // the #turns Travel button and the web map, or two map clicks — both passed
  // the check and both moved, while @@unique([characterId, turnId]) let only
  // one Action through. The player ended up two hops away having spent one
  // Move, and the old comment here accepted that as the cost of not having a
  // transaction.
  //
  // Filing first makes the unique constraint the gate rather than an
  // afterthought: the loser's create raises P2002, which aborts the
  // transaction, and the move it would have made is rolled back with it.
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
            description: `Traveled to ${targetLocation.name}.`,
            zoneId: targetLocation.zoneId,
            resultMessage: `» Traveled to ${targetLocation.name}.`,
            gmNotes: "auto:zone_change",
          },
        });
      }

      await tx.character.update({
        where: { id: character.id },
        data: { locationId: targetLocation.id, zoneId: targetLocation.zoneId },
      });
    });
  } catch (err) {
    if (err.code === "ALREADY_ACTED" || err.code === "P2002") {
      return { ok: false, reason: "You've already acted this turn." };
    }
    throw err;
  }

  // Off by default (see GameConfig.archiveTravelEvents): arrivals are what
  // make a location read like a story, and also two rows per character per
  // turn before anyone says a word.
  const config = await prisma.gameConfig.findUnique({
    where: { id: 1 },
    select: { archiveTravelEvents: true },
  });
  if (config?.archiveTravelEvents) {
    await recordArchiveEvent(prisma, {
      kind: "TRAVEL",
      character,
      locationId: targetLocation.id,
      locationName: targetLocation.name,
      content: currentLocation
        ? `${character.name} left ${currentLocation.name} for ${targetLocation.name}.`
        : `${character.name} arrived at ${targetLocation.name}.`,
    });
  }

  return { ok: true, free, oldLocation: currentLocation };
}

module.exports = { performTravel };
