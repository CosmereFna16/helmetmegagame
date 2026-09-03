// The dead sheet follows its corpse. docs/systemdocs/CORPSES.md.
//
// A corpse tag is a handle to a Character row, and this is the half that makes
// that mean something: wherever the tag ends up — a Room's stash, or somebody's
// pocket — the dead character's locationId and zoneId are moved to match. Once
// they agree, db/lib/presence.js#isHere makes the body lootable there with NO
// edit to lootCharacterRequestImpl at all, and Move/Harm come along for free.
//
// PULL-BASED, and it has to be. The obvious design is to push from whatever
// moved the tag, and it cannot work: the case this feature exists for — you
// pick a body up and WALK somewhere — involves no tag write whatsoever. Only
// the carrier's own locationId changed. So this recomputes from current state
// instead of being told, the same reasoning settleCarry and
// roomAccess.js#syncCharacterRoomAccess both give.
//
// POST-COMMIT, never inside a caller's transaction: it is a plain write but it
// runs beside settleCarry, which talks to Discord.
//
// Takes `prisma` as a parameter (db/lib/dm.js convention); off the barrel.

// Where a corpse tag physically is, in precedence order:
//   1. in someone's hands  -> that holder's Location
//   2. lying in a Room     -> that Room's Location
//   3. nowhere             -> leave the dead row exactly as it is
//
// 1 beats 2 because a tag can briefly be both mid-transfer, and the pocket is
// the more specific answer. "Nowhere" is a real state (a buried or butchered
// body's tag is gone) and must never be read as "move them to null" — that
// would unplace every buried character on the next pass.
async function placementFor(prisma, tag) {
  const held = await prisma.characterTag.findFirst({
    where: { tagId: tag.id },
    select: { character: { select: { id: true, locationId: true, zoneId: true } } },
  });
  if (held?.character?.locationId) {
    // A corpse sitting on its OWN sheet is the no-public-room fallback from
    // mintCorpse. It is already where it belongs; moving it to itself is a
    // no-op, but say so rather than leaving the reader to work it out.
    return { locationId: held.character.locationId, zoneId: held.character.zoneId };
  }
  const stashed = await prisma.roomTag.findFirst({
    where: { tagId: tag.id },
    select: { room: { select: { locationId: true, location: { select: { zoneId: true } } } } },
  });
  if (stashed?.room?.locationId) {
    return { locationId: stashed.room.locationId, zoneId: stashed.room.location?.zoneId ?? null };
  }
  return null;
}

// Reconcile one body. Cheap enough to call on any path that might have moved
// a corpse, and a no-op when nothing did.
async function reconcileCorpse(prisma, tag) {
  if (!tag?.corpseOfCharacterId) return null;
  const where = await placementFor(prisma, tag);
  if (!where) return null;

  // Only ever moves a DEAD, unburied sheet. A Revive clears the corpse tag
  // (see reviveCharacter), but the guard is here too: teleporting a living
  // character because their old body is in someone's bag would be a very
  // confusing bug to chase.
  const moved = await prisma.character.updateMany({
    where: {
      id: tag.corpseOfCharacterId,
      status: "DEAD",
      buriedAt: null,
      NOT: { locationId: where.locationId },
    },
    data: { locationId: where.locationId, zoneId: where.zoneId },
  });
  return moved.count > 0 ? { characterId: tag.corpseOfCharacterId, ...where } : null;
}

// Every body at once. Takes no arguments on purpose: the callers that need it
// (an arrival, the turn close) know a corpse MIGHT have moved but not which,
// and the scan is bounded by the number of deaths in the game.
async function reconcileCorpses(prisma) {
  const corpses = await prisma.tag.findMany({
    where: { corpseOfCharacterId: { not: null }, corpseOf: { status: "DEAD", buriedAt: null } },
    select: { id: true, corpseOfCharacterId: true },
  });
  const moved = [];
  for (const tag of corpses) {
    const result = await reconcileCorpse(prisma, tag).catch((err) => {
      console.error(`corpseFollow: failed to reconcile tag ${tag.id}:`, err);
      return null;
    });
    if (result) moved.push(result);
  }
  return moved;
}

module.exports = { reconcileCorpse, reconcileCorpses };
