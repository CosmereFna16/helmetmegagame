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

  const free = isTravelFree({
    fromSlug: currentLocation?.slug ?? null,
    fromZoneId: character.zoneId,
    toSlug: targetLocation.slug ?? null,
    toZoneId: targetLocation.zoneId,
  });

  let openTurn = null;
  if (!free) {
    openTurn = await prisma.turn.findFirst({ where: { status: "OPEN" } });
    if (!openTurn) return { ok: false, reason: "No turn is currently open." };

    // The same check actionSubmission.js makes in reverse: acting and
    // changing zones are mutually exclusive within a turn, in either order.
    const existing = await prisma.action.findFirst({
      where: { characterId: character.id, turnId: openTurn.id },
    });
    if (existing) return { ok: false, reason: "You've already acted this turn." };
  }

  await prisma.character.update({
    where: { id: character.id },
    data: { locationId: targetLocation.id, zoneId: targetLocation.zoneId },
  });

  if (!free) {
    await prisma.action.create({
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
