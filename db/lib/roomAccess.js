// Private-room membership, reconciled the way narrowcast access is: recomputed
// from the character's CURRENT location and tags at every arrival and every
// tag change, never pushed from inside a tag writer. A private Room is a
// private thread whose members should be exactly the characters standing in
// its Location who hold one of Room.accessTagSlugs — a key tag gained opens
// the door, a key tag lost closes it.
//
// Plus GUESTS. /add in a private Room writes a RoomGuest row, which admits
// somebody who holds no key at all. The row is spent when they leave: this
// file deletes every guest row whose Room is not where the character now
// stands, and every mover already calls in here with the destination, so
// walking out is what shuts the door behind you.
//
// Pure REST (thread-member calls have no gateway-only form), so both faces
// and the staged push call this one function. Takes `prisma` as a parameter
// — the db/lib/dm.js convention — and is deliberately not on the @lifeweb/db
// barrel; require it by path.
const { addThreadMember, removeThreadMember } = require("./discordRest");

// The rooms in `locationId` this character may enter. Shared with the channel
// doctor, the Secret rooms? button, the Storage button, the Transfer dialog,
// corpse placement and equipment reach, so all of them agree about one door.
//
// `guestRoomIds` defaults empty: a caller that genuinely only cares about keys
// (the sync, which has no character in hand) can leave it off, but anything
// deciding what a PERSON can reach must pass it, or a guest sees the thread
// and is then told the stash isn't theirs.
function accessibleRooms(rooms, heldSlugs, guestRoomIds = new Set()) {
  return rooms.filter(
    (room) =>
      room.kind !== "PRIVATE" ||
      guestRoomIds.has(room.id) ||
      room.accessTagSlugs.some((slug) => heldSlugs.has(slug)),
  );
}

async function heldTagSlugs(prisma, characterId) {
  const tags = await prisma.characterTag.findMany({
    where: { characterId },
    select: { tag: { select: { slug: true } } },
  });
  return new Set(tags.map((t) => t.tag.slug));
}

// The rooms this character has been let into by hand.
async function guestRoomIds(prisma, characterId) {
  const rows = await prisma.roomGuest.findMany({
    where: { characterId },
    select: { roomId: true },
  });
  return new Set(rows.map((r) => r.roomId));
}

// Both halves of the door in one round trip. Every caller that asks "what can
// this character reach" wants both, and loading them separately is how the two
// answers drift apart.
async function roomAccessKeys(prisma, characterId) {
  const [heldSlugs, guests] = await Promise.all([
    heldTagSlugs(prisma, characterId),
    guestRoomIds(prisma, characterId),
  ]);
  return { heldSlugs, guestRoomIds: guests };
}

// `character` needs { id, discordUserId, locationId, status }; `tagSlugs` may
// be passed by a caller that already holds them. Returns { added, removed }.
// Every private room in the character's location gets exactly one idempotent
// call (add or remove); private rooms elsewhere get a remove. A miss is
// logged and left for the doctor.
//
// `locationOnly` drops the elsewhere-removes. Each of those is a Discord round
// trip, they run one at a time, and there are as many of them as there are
// private rooms in the game — so a caller that cannot possibly have changed
// where somebody is standing was paying the whole bill for nothing. Leaving a
// Location already spends the membership, so there is nothing there to remove.
// The MOVER must never pass it: crossing a Location is precisely the case those
// removes exist for. The doctor's room-occupancy check is the backstop either
// way.
async function syncCharacterRoomAccess(prisma, character, { tagSlugs = null, locationOnly = false } = {}) {
  const result = { added: 0, removed: 0 };
  if (!character?.discordUserId) return result;

  const rooms = await prisma.room.findMany({
    where: {
      kind: "PRIVATE",
      discordThreadId: { not: null },
      // Narrowed in the QUERY rather than filtered after it, so a locationOnly
      // caller does not even read the rows it has no calls to make for.
      ...(locationOnly && character.locationId ? { locationId: character.locationId } : {}),
    },
    select: { id: true, name: true, locationId: true, kind: true, accessTagSlugs: true, discordThreadId: true },
  });

  // Spend every guest grant that is no longer where the character is standing.
  // Before the membership recompute below, so the recompute reads the rows this
  // just settled, and before the DISCORD_TOKEN bail-out, so a caller that got
  // this far still gets the row right even when it cannot reach Discord.
  //
  // That is not a promise the whole game keeps, though: the mover
  // (locationMove.js#applyLocationMoveSideEffects) has its OWN token guard
  // ahead of its call into here, so a tokenless move never reaches this line.
  // Nothing else about such a move works either — no overwrite swap, no role
  // swap — and the doctor's room-guest check is the backstop.
  const alive = character.status === "ALIVE";
  await prisma.roomGuest
    .deleteMany({
      where: {
        characterId: character.id,
        ...(alive && character.locationId ? { room: { locationId: { not: character.locationId } } } : {}),
      },
    })
    .catch((err) => console.error(`Room guest sweep failed for ${character.id}:`, err.message ?? err));

  if (rooms.length === 0) return result;
  if (!process.env.DISCORD_TOKEN) return result;

  const held = alive && character.locationId ? tagSlugs ?? (await heldTagSlugs(prisma, character.id)) : new Set();
  const guests = alive && character.locationId ? await guestRoomIds(prisma, character.id) : new Set();
  const here = alive && character.locationId
    ? new Set(
        accessibleRooms(rooms.filter((r) => r.locationId === character.locationId), held, guests).map((r) => r.id),
      )
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

module.exports = {
  syncCharacterRoomAccess,
  accessibleRooms,
  heldTagSlugs,
  guestRoomIds,
  roomAccessKeys,
};
