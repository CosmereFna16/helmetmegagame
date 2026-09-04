// The Godard Factory floor: a day's labor that pays in cubes instead of ⬢.
//
// Everywhere else in the game a Labor resolves to a "min-max" range of
// Resources (docs/systemdocs/LABORING.md §4). A refinery is the one exception,
// and it is a Location attribute rather than a slug so nothing here has to
// know where the Factory is: `refinery: true` in docs/zones.yaml, checked
// through db/lib/locationAttributes.js#hasAttribute.
//
// One Godflesh in, eight Squeeze out, once per day like any other Labor. The
// input may be in the worker's own hands OR in any Room stash at the Location
// they can get into — the Logistics Room is where a shift's haul actually
// lives, and making somebody carry a 28 lb lump around the floor all day to
// prove they own it would be silly.
//
// Prisma is a parameter, never a require: this sits in db/lib/ and the barrel
// would resolve to a partial exports object (the db/lib/dm.js convention).
const { accessibleRooms } = require("./roomAccess");
const { addToStack, dropCharacterTag, dropRoomTag, addToRoomStack } = require("./tagWrites");
const { hasAttribute } = require("./locationAttributes");

const REFINERY_ATTRIBUTE = "refinery";
const REFINERY_INPUT_SLUG = "godflesh";
const REFINERY_OUTPUT_SLUG = "squeeze";
// Eight cubes is a day's work, and the number the economy is balanced on:
// docs/systemdocs/FACTORY.md carries the arithmetic.
const REFINERY_YIELD = 8;

function isRefinery(location) {
  return hasAttribute(location, REFINERY_ATTRIBUTE);
}

// Where the input can be found for one worker, or null when there is none.
// `rooms` is the Room rows at their Location that hold Godflesh, already
// narrowed to the ones they may enter.
//
//   { kind: "held" } | { kind: "room", roomId }
function inputSource({ holdsInput = false, rooms = [] } = {}) {
  if (holdsInput) return { kind: "held" };
  const room = rooms[0];
  return room ? { kind: "room", roomId: room.id } : null;
}

// The bulk half, for the auto-labor pass: every Room at any of these Locations
// that is holding Godflesh, with the keys it wants. Two queries for a whole
// roster rather than two per character.
async function loadRefineryStashes(prisma, locationIds) {
  if (!locationIds?.length) return { roomsByLocation: new Map(), guestsByCharacter: new Map() };
  const rooms = await prisma.room.findMany({
    where: {
      locationId: { in: locationIds },
      tags: { some: { quantity: { gt: 0 }, tag: { slug: REFINERY_INPUT_SLUG } } },
    },
    select: { id: true, kind: true, accessTagSlugs: true, locationId: true },
  });
  const guests = rooms.length
    ? await prisma.roomGuest.findMany({
        where: { roomId: { in: rooms.map((r) => r.id) } },
        select: { roomId: true, characterId: true },
      })
    : [];

  const roomsByLocation = new Map();
  for (const room of rooms) {
    if (!roomsByLocation.has(room.locationId)) roomsByLocation.set(room.locationId, []);
    roomsByLocation.get(room.locationId).push(room);
  }
  const guestsByCharacter = new Map();
  for (const row of guests) {
    if (!guestsByCharacter.has(row.characterId)) guestsByCharacter.set(row.characterId, new Set());
    guestsByCharacter.get(row.characterId).add(row.roomId);
  }
  return { roomsByLocation, guestsByCharacter };
}

// Does this worker have anything to refine? Pure, so the auto-labor pass can
// ask it once per character off state it already loaded.
function refineryInputFor({ characterId, locationId, heldSlugs }, stashes) {
  const holdsInput = heldSlugs.has(REFINERY_INPUT_SLUG);
  const rooms = accessibleRooms(
    stashes?.roomsByLocation?.get(locationId) ?? [],
    heldSlugs,
    stashes?.guestsByCharacter?.get(characterId) ?? new Set(),
  );
  return inputSource({ holdsInput, rooms });
}

// The single-character async form, for the Move modal and the Labor? button.
async function refineryInput(prisma, character) {
  if (!character?.id || !character?.locationId) return null;
  const [stashes, held, guests] = await Promise.all([
    loadRefineryStashes(prisma, [character.locationId]),
    prisma.characterTag.findMany({
      where: { characterId: character.id, quantity: { gt: 0 } },
      select: { tag: { select: { slug: true } } },
    }),
    prisma.roomGuest.findMany({ where: { characterId: character.id }, select: { roomId: true } }),
  ]);
  stashes.guestsByCharacter.set(character.id, new Set(guests.map((g) => g.roomId)));
  return refineryInputFor(
    {
      characterId: character.id,
      locationId: character.locationId,
      heldSlugs: new Set(held.map((h) => h.tag.slug)),
    },
    stashes,
  );
}

// Runs one refining shift inside the caller's transaction. Returns the
// snapshot to stamp on Action.appliedEffects, or null when there was nothing
// to work — the snapshot is what Undo reads, never live state
// (docs/systemdocs/REQUESTS.md §2).
async function applyRefinery(tx, characterId, locationId) {
  const location = await tx.location.findUnique({
    where: { id: locationId ?? "" },
    select: { id: true, attributes: true },
  });
  if (!isRefinery(location)) return null;

  const [input, output] = await Promise.all([
    tx.tag.findUnique({ where: { slug: REFINERY_INPUT_SLUG }, select: { id: true } }),
    tx.tag.findUnique({ where: { slug: REFINERY_OUTPUT_SLUG }, select: { id: true, stackable: true } }),
  ]);
  if (!input || !output) {
    console.error(
      `Refinery: missing "${REFINERY_INPUT_SLUG}" or "${REFINERY_OUTPUT_SLUG}" tag — run npm run db:sync-tags.`,
    );
    return null;
  }

  const [held, guests, rooms] = await Promise.all([
    tx.characterTag.findMany({
      where: { characterId, quantity: { gt: 0 } },
      select: { tag: { select: { slug: true } } },
    }),
    tx.roomGuest.findMany({ where: { characterId }, select: { roomId: true } }),
    tx.room.findMany({
      where: { locationId, tags: { some: { tagId: input.id, quantity: { gt: 0 } } } },
      select: { id: true, kind: true, accessTagSlugs: true },
    }),
  ]);
  const heldSlugs = new Set(held.map((h) => h.tag.slug));
  const source = inputSource({
    holdsInput: heldSlugs.has(REFINERY_INPUT_SLUG),
    rooms: accessibleRooms(rooms, heldSlugs, new Set(guests.map((g) => g.roomId))),
  });
  if (!source) return null;

  if (source.kind === "held") {
    await dropCharacterTag(tx, characterId, input.id, 1);
  } else if (!(await dropRoomTag(tx, source.roomId, input.id, 1))) {
    // Somebody else's shift took the last lump between the read and the
    // write. Refuse cleanly rather than minting cubes out of nothing.
    return null;
  }

  await addToStack(tx, characterId, output.id, REFINERY_YIELD, {
    source: "EVENT",
    stackable: output.stackable,
  });

  return {
    consumed: { tagId: input.id, slug: REFINERY_INPUT_SLUG, quantity: 1, ...source },
    produced: { tagId: output.id, slug: REFINERY_OUTPUT_SLUG, quantity: REFINERY_YIELD },
  };
}

// The exact inverse of the snapshot: the cubes come off, and the lump goes
// back where it was taken from — the worker's hands or the room's floor.
async function revertRefinery(tx, characterId, snapshot) {
  const consumed = snapshot?.consumed;
  const produced = snapshot?.produced;
  if (produced?.tagId) {
    await dropCharacterTag(tx, characterId, produced.tagId, produced.quantity ?? REFINERY_YIELD);
  }
  if (!consumed?.tagId) return;
  if (consumed.kind === "room" && consumed.roomId) {
    await addToRoomStack(tx, consumed.roomId, consumed.tagId, consumed.quantity ?? 1);
  } else {
    await addToStack(tx, characterId, consumed.tagId, consumed.quantity ?? 1, {
      source: "EVENT",
      stackable: true,
    });
  }
}

module.exports = {
  REFINERY_ATTRIBUTE,
  REFINERY_INPUT_SLUG,
  REFINERY_OUTPUT_SLUG,
  REFINERY_YIELD,
  isRefinery,
  loadRefineryStashes,
  refineryInputFor,
  refineryInput,
  applyRefinery,
  revertRefinery,
};
