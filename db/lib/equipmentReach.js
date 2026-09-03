// "Is that kit within reach?" — the one question Craft and Heal both ask about
// a piece of standing equipment (docs/systemdocs/CRAFTING.md, TAGS.md §5c).
//
// Two kits use this. WORKSHOP EQUIPMENT is what lets you smith or build at
// all; SURGICAL EQUIPMENT is worth +1 on a medical Gambit. Both are heavy
// Items rather than Assets on purpose: somebody had to haul them there, and a
// Sanctuary operating theatre or a Factory floor is simply a room where
// somebody already did.
//
// Reach is NOT re-derived here. It is the same predicate the private-room
// threads are synced with — standing in the room's Location, and admitted to
// the room — so a door and a gate can never disagree about The Charon. See
// db/lib/roomAccess.js#accessibleRooms and web/lib/transferReach.js.
//
// Takes `prisma` as a parameter and stays off the @lifeweb/db barrel, the
// db/lib/dm.js convention; require it by path.
const { accessibleRooms, roomAccessKeys } = require("./roomAccess");

// True when the character holds the tag, or one sits in a Room stash they can
// get into at the Location they are standing in.
//
// `character` needs { id, locationId }. Held tags are re-read rather than
// taken from a passed row: every caller here is a server action re-checking
// what a client claimed, and a stale row is exactly what it must not trust.
async function hasEquipmentInReach(prisma, character, slug) {
  if (!character?.id || !slug) return false;

  const held = await prisma.characterTag.findFirst({
    where: { characterId: character.id, quantity: { gt: 0 }, tag: { slug } },
    select: { id: true },
  });
  if (held) return true;

  // Nowhere to stand is nowhere to reach from.
  if (!character.locationId) return false;

  const [rooms, keys] = await Promise.all([
    prisma.room.findMany({
      where: { locationId: character.locationId, tags: { some: { quantity: { gt: 0 }, tag: { slug } } } },
      select: { id: true, kind: true, accessTagSlugs: true },
    }),
    roomAccessKeys(prisma, character.id),
  ]);
  return accessibleRooms(rooms, keys.heldSlugs, keys.guestRoomIds).length > 0;
}

module.exports = { hasEquipmentInReach };
