// Parking a cart or a mount at the door (docs/systemdocs/CARRY.md §3).
//
// A Location marked `indoors: true` in docs/zones.yaml is a place you walk
// INTO — the Cathedral, the Sanctuary, the Inn, the Keep, the Undercroft, the
// Factory. You cannot bring a horse into a chapel, so arriving unequips
// anything stowable and says so. The carry bonus goes with it, which is the
// whole point: the cap shrinks, and the character is very likely Overburdened
// until they walk back out and take the reins again.
//
// Nothing is ever DROPPED for this. settleCarry's overflow is
// acquisition-driven, so losing capacity at a door makes someone Overburdened
// and no more — walking into an inn must never dump a cart's contents onto the
// floor of it.
//
// Takes `prisma` as a parameter and stays off the @lifeweb/db barrel, the same
// posture as carry.js, because locationMove.js requires it.
const { STOWABLE_SLUGS } = require("./mounts");

// Unequips every stowable this character has out, if they are standing
// somewhere indoors. Returns the display names parked, so the caller can DM
// them — this module does no Discord work of its own.
async function parkMountsIndoors(prisma, characterId, locationId) {
  if (!characterId || !locationId) return [];
  const location = await prisma.location.findUnique({
    where: { id: locationId },
    select: { indoors: true, name: true },
  });
  if (!location?.indoors) return [];

  const held = await prisma.characterTag.findMany({
    where: { characterId, equipped: true, tag: { slug: { in: [...STOWABLE_SLUGS] } } },
    select: { id: true, tag: { select: { name: true } } },
  });
  if (held.length === 0) return [];

  await prisma.characterTag.updateMany({
    where: { id: { in: held.map((ct) => ct.id) } },
    data: { equipped: false },
  });
  return held.map((ct) => ct.tag.name);
}

// The sentence the DM carries. Kept here beside the rule so the bot and the
// web app can never word it differently.
function parkedMessage(names, locationName) {
  const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  return `You leave your ${list} outside ${locationName}. You can take ${names.length === 1 ? "it" : "them"} up again on your way out. ‡`;
}

module.exports = { parkMountsIndoors, parkedMessage };
