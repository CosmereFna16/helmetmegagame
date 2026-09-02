// Private-room membership, reconciled the way narrowcast access is: recomputed
// from the character's CURRENT location and tags at every arrival and every
// tag change, never pushed from inside a tag writer. A private Room is a
// private thread whose members should be exactly the characters standing in
// its Location who hold one of Room.accessTagSlugs — a key tag gained opens
// the door, a key tag lost closes it.
//
// Pure REST (thread-member calls have no gateway-only form), so both faces
// and the staged push call this one function. Takes `prisma` as a parameter
// — the db/lib/dm.js convention — and is deliberately not on the @lifeweb/db
// barrel; require it by path.
const { addThreadMember, removeThreadMember } = require("./discordRest");

// The rooms in `locationId` a holder of `heldSlugs` may enter. Shared with
// the channel doctor and the Secret rooms? button so all three agree.
function accessibleRooms(rooms, heldSlugs) {
  return rooms.filter(
    (room) => room.kind !== "PRIVATE" || room.accessTagSlugs.some((slug) => heldSlugs.has(slug)),
  );
}

async function heldTagSlugs(prisma, characterId) {
  const tags = await prisma.characterTag.findMany({
    where: { characterId },
    select: { tag: { select: { slug: true } } },
  });
  return new Set(tags.map((t) => t.tag.slug));
}

// `character` needs { id, discordUserId, locationId, status }; `tagSlugs` may
// be passed by a caller that already holds them. Returns { added, removed }.
// Every private room in the character's location gets exactly one idempotent
// call (add or remove); private rooms elsewhere get a remove. A miss is
// logged and left for the doctor.
async function syncCharacterRoomAccess(prisma, character, { tagSlugs = null } = {}) {
  const result = { added: 0, removed: 0 };
  if (!character?.discordUserId) return result;
  if (!process.env.DISCORD_TOKEN) return result;

  const rooms = await prisma.room.findMany({
    where: { kind: "PRIVATE", discordThreadId: { not: null } },
    select: { id: true, name: true, locationId: true, kind: true, accessTagSlugs: true, discordThreadId: true },
  });
  if (rooms.length === 0) return result;

  const alive = character.status === "ALIVE";
  const held = alive && character.locationId ? tagSlugs ?? (await heldTagSlugs(prisma, character.id)) : new Set();
  const here = alive && character.locationId
    ? new Set(accessibleRooms(rooms.filter((r) => r.locationId === character.locationId), held).map((r) => r.id))
    : new Set();

  for (const room of rooms) {
    try {
      if (here.has(room.id)) {
        await addThreadMember(room.discordThreadId, character.discordUserId);
        result.added += 1;
      } else {
        await removeThreadMember(room.discordThreadId, character.discordUserId);
        result.removed += 1;
      }
    } catch (err) {
      console.error(`Room access sync failed for ${character.id} in "${room.name}":`, err.message ?? err);
    }
  }
  return result;
}

module.exports = { syncCharacterRoomAccess, accessibleRooms, heldTagSlugs };
