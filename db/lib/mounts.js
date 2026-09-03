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

// Tags that stop working the moment they leave your hands. Cart is here for
// its carry multiplier and its extra seats; the mounts for their free move.
const STOWABLE_SLUGS = new Set([...FAST_TRAVEL_SLUGS, "cart"]);

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

// Holding a mount or a cart but not having it out. Travel asks so it can warn
// before someone walks a day's road with a horse in their pocket.
function stowedSlugs(characterTags = []) {
  return (characterTags ?? [])
    .filter((ct) => STOWABLE_SLUGS.has(ct?.tag?.slug) && ct.equipped !== true)
    .map((ct) => ct.tag.slug);
}

module.exports = {
  FAST_TRAVEL_SLUGS,
  STOWABLE_SLUGS,
  equippedSlugs,
  fastTravelCapacity,
  isMounted,
  stowedSlugs,
};
