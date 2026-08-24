// Whether a hop between two Locations is free or spends the character's
// Move for the turn. Pure rules, no prisma — same posture as
// narrowcastAccess.js and laborAccess.js, and matched on Location **slug**
// for the same reason (Zone has no slug, and these rules are authored
// against docs/locations.yaml's fixed identifiers).
//
// Shared by db/lib/travel.js (which both faces of the game go through) and
// by web/app/(app)/map/page.js, which colours each node by asking this the
// same question the server will ask on submit — so the map can never
// promise a free hop the server then charges for.

// The three levels of the Depths, deepening in order. They sit in the Caves
// zone alongside Customs, so the ordinary same-zone-is-free rule would make
// the whole descent a single turn's walk. It isn't: each level down is its
// own Move. This is the one place in the game where two Locations in one
// Zone cost a turn to move between, and it is deliberate rather than a
// fallout of how the zones are drawn — going deeper is supposed to hurt.
const DEPTHS_SLUGS = new Set(["caverns", "railroad", "aberrant-pits"]);

function isTravelFree({ fromSlug, fromZoneId, toSlug, toZoneId }) {
  // No zone yet means this is a first-ever placement, which is always free
  // (and, in performTravel, unrestricted by adjacency too).
  if (!fromZoneId) return true;
  if (DEPTHS_SLUGS.has(fromSlug) && DEPTHS_SLUGS.has(toSlug)) return false;
  return fromZoneId === toZoneId;
}

module.exports = { DEPTHS_SLUGS, isTravelFree };
