// The mount tags — what buys a character an extra free zone crossing each turn
// (db/lib/locationTravel.js) and how many people the mount seats. Lives in db/
// so both faces read one set; web/lib/tagRequests.js re-exports it for the page
// gates. See DEPOT.md §3 and CARRY.md §2.
//
// A mount only works while it is EQUIPPED. That is the whole discouragement
// behind making Cart and Horse equippable: they compete for the same
// GameConfig.equipSlots as your armour and your weapon, and they are unequipped
// at the door of any indoors Location. So every helper here takes the slugs a
// character has ACTIVE, not merely the ones they hold — `equippedSlugs` below
// is what builds that set, and callers must not hand these functions a bare
// held-slug set by mistake.
const FAST_TRAVEL_SLUGS = new Set(["horse", "steam-automobile"]);

// The boat is deliberately NOT a fast-travel mount. It buys the same extra
// crossing, but only between the three zones the water actually connects, and
// it does none of the other things that set does: no passengers, no cancelling
// a ruined leg, no passing a mounted-only gate. Keeping it out of
// FAST_TRAVEL_SLUGS is what holds all three of those true for free.
const WATER_TRAVEL_SLUGS = new Set(["fishing-boat"]);

// Where a boat is any use. Zone SLUGS, not names — `east-forests` is the Black
// Hills (docs/zones.yaml keeps the old id on purpose).
const WATER_ZONE_SLUGS = new Set(["forest", "east-forests", "marshes"]);

// Tags that stop working the moment they leave your hands. Cart is here for
// its carry multiplier and its extra seats; the mounts and the boat for their
// free move.
const STOWABLE_SLUGS = new Set([...FAST_TRAVEL_SLUGS, ...WATER_TRAVEL_SLUGS, "cart"]);

// A boat and a horse are the same slot in fiction — you are either riding or
// poling — so equipping one refuses while the other is out
// (web/app/(app)/character/equipActions.js).
const BOAT_CONFLICT_SLUGS = new Set([...FAST_TRAVEL_SLUGS, "cart"]);

// The slugs a character currently has in play: everything they hold, minus any
// stowable that is not equipped.
function equippedSlugs(characterTags = []) {
  const active = new Set();
  for (const ct of characterTags) {
    const slug = ct?.tag?.slug;
    if (!slug) continue;
    if (STOWABLE_SLUGS.has(slug) && ct.equipped !== true) continue;
    active.add(slug);
  }
  return active;
}

// Seats a mount carries, rider included. Steam Automobile is a fixed 6 and
// doesn't stack with Cart. A horse alone seats 2; Cart upgrades to 6.
function fastTravelCapacity(activeSlugs) {
  if (activeSlugs.has("steam-automobile")) return 6;
  if (!activeSlugs.has("horse")) return 0;
  return activeSlugs.has("cart") ? 6 : 2;
}

function isMounted(activeSlugs) {
  for (const slug of FAST_TRAVEL_SLUGS) if (activeSlugs.has(slug)) return true;
  return false;
}

function isBoated(activeSlugs) {
  for (const slug of WATER_TRAVEL_SLUGS) if (activeSlugs.has(slug)) return true;
  return false;
}

// Whether a boat helps with THIS crossing. Both ends have to be on the water,
// so Forest -> Marshes is free and Forest -> Town is not. A caller that does
// not know the crossing (the sheet, which shows an allowance before anyone has
// picked a destination) passes nothing and gets false, which is the honest
// answer: the boat's extra move is not banked, it is earned per crossing.
function boatCrossing(fromZoneSlug, toZoneSlug) {
  if (!fromZoneSlug || !toZoneSlug) return false;
  return WATER_ZONE_SLUGS.has(fromZoneSlug) && WATER_ZONE_SLUGS.has(toZoneSlug);
}

// Holding a mount or a cart but not having it out. Travel asks so it can warn
// before someone walks a day's road with a horse in their pocket.
//
// Returns display NAMES, not slugs — this goes straight into a sentence a
// player reads, and "you're carrying a steam-automobile" is not a sentence.
// Falls back to the slug only if a caller passed rows without one.
function stowedMounts(characterTags = []) {
  return (characterTags ?? [])
    .filter((ct) => STOWABLE_SLUGS.has(ct?.tag?.slug) && ct.equipped !== true)
    .map((ct) => ct.tag.name ?? ct.tag.slug);
}

module.exports = {
  FAST_TRAVEL_SLUGS,
  WATER_TRAVEL_SLUGS,
  WATER_ZONE_SLUGS,
  BOAT_CONFLICT_SLUGS,
  STOWABLE_SLUGS,
  equippedSlugs,
  fastTravelCapacity,
  isMounted,
  isBoated,
  boatCrossing,
  stowedMounts,
};
