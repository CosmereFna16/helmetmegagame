// "Here": the one co-presence rule both faces of the game judge by.
//
// A character can act on someone standing at the same Location who hasn't
// hidden their face — and, for the actions that work on a body, on an
// unburied corpse. Location-grain since Bascinet 2; a concealed character is
// off every picker and every gate because /conceal is the game's "you don't
// know who this is", and naming them would undo it. A corpse can't hold a
// hood up, so the dead show when `allowDead` asks for them.
//
// web/lib/peopleHere.js binds these to prisma for the web app; the bot's
// offer handlers (bot/src/lib/offers.js) and db/lib/lessons.js call them
// directly. No Prisma import here on purpose — same posture as
// inspectVision.js.

// The Prisma where-clause for "everyone here but me".
function hereWhere(character, { includeDead = false } = {}) {
  return {
    locationId: character.locationId,
    id: { not: character.id },
    OR: [
      { status: "ALIVE", concealed: false },
      ...(includeDead ? [{ status: "DEAD", buriedAt: null }] : []),
    ],
  };
}

// The gate. Both rows need `locationId`; the target also `status`,
// `concealed` and `buriedAt`. Reaching yourself is free — you are always
// where you are. An unplaced actor reaches no one: nowhere is not everywhere.
function isHere(actor, target, { allowDead = false } = {}) {
  if (!actor?.locationId || !target) return false;
  if (target.id === actor.id) return true;
  if (target.locationId !== actor.locationId) return false;
  if (target.status === "ALIVE") return !target.concealed;
  if (allowDead && target.status === "DEAD") return !target.buriedAt;
  return false;
}

// The select a caller adds to a target row so isHere can judge it.
const HERE_FIELDS = { id: true, locationId: true, status: true, concealed: true, buriedAt: true };

// One message for every "they aren't here" refusal, so the actions agree.
function notHereMessage(target) {
  return target?.name ? `${target.name} isn't here. ‡` : "They aren't here. ‡";
}

module.exports = { hereWhere, isHere, HERE_FIELDS, notHereMessage };
