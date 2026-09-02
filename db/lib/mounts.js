// The mount tags — what lets a character cross into a second zone in one
// turn (db/lib/locationTravel.js) and how many people the mount seats. Lives
// in db/ so both faces read one set; web/lib/tagRequests.js re-exports it for
// the page gates. See DEPOT.md §3.
const FAST_TRAVEL_SLUGS = new Set(["horse", "wild-horse", "steam-automobile"]);

// Seats a mount carries, rider included. Steam Automobile is a fixed 6 and
// doesn't stack with Cart. A horse alone seats 2; Cart upgrades to 6.
function fastTravelCapacity(heldSlugs) {
  if (heldSlugs.has("steam-automobile")) return 6;
  const hasHorse = heldSlugs.has("horse") || heldSlugs.has("wild-horse");
  if (!hasHorse) return 0;
  return heldSlugs.has("cart") ? 6 : 2;
}

function isMounted(heldSlugs) {
  for (const slug of FAST_TRAVEL_SLUGS) if (heldSlugs.has(slug)) return true;
  return false;
}

module.exports = { FAST_TRAVEL_SLUGS, fastTravelCapacity, isMounted };
