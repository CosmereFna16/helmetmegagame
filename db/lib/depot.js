// The Merchant's Depot: the shared constants and pure helpers behind
// /depot and the three DEPOT_* request kinds. See docs/systemdocs/DEPOT.md.
//
// This lives in db/lib rather than web/lib because the numbers are game
// balance, not page logic — the same reason production.js is here. Nothing in it touches Prisma or the network, so it is safe on the
// barrel and safe to import from either face.

// The tag that opens the counter. Holding it is the whole permission model:
// the /depot route gate, the server-action re-check, and (in fiction) the
// reason the Depot's mini-turret does not shoot you. It is tradeable, so the
// Merchant handing it away really does hand away the Depot.
const MERCHANT_LICENSE_SLUG = "merchants-license";

// Where the shuttle is parked. Buying and selling both require standing here,
// the same way the Lifeweb requires the Fortress — you cannot trade with a
// craft you are not next to.
//
// A LOCATION slug from docs/zones.yaml, not a zone one. The Depot used to be
// a paragraph inside the Customs description and the gate was the whole
// Caverns zone, which meant trading from anywhere underground. Bascinet 2
// draws it as its own place, so standing there is now literal.
const DEPOT_LOCATION_SLUG = "depot";

// One sanity bound on a single line item, so a fat-fingered quantity cannot
// file a request for ten thousand vials. Well above any real purchase.
const DEPOT_MAX_QUANTITY = 99;

// Coerce a client-supplied quantity to a whole number inside the allowed
// range. Returns null for anything that is not a usable count, so callers can
// reject rather than silently trade 1 of something the player asked 0 of.
function normalizeQuantity(raw) {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > DEPOT_MAX_QUANTITY) return null;
  return n;
}

module.exports = {
  MERCHANT_LICENSE_SLUG,
  DEPOT_LOCATION_SLUG,
  DEPOT_MAX_QUANTITY,
  normalizeQuantity,
};
