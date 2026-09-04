// Seat math for a Role, shared by the character-creation picker, the
// createCharacter server action's race check, and the GM panel — so all
// three agree on what "full" means.
//
// The three shapes come straight from docs/roles.yaml's multiple/weight
// pair (see Role in schema.prisma):
//   isUnique  -> exactly 1 seat, at any game size. A single named character
//                (Baron, Bishop, Headman) — NOT the same as "1 per 100".
//   unlimited -> uncapped chaff roles (Commoner, Migrant).
//   weight    -> seats per 100 players, scaled by GameConfig.playerCount.
//
// Returns Infinity for uncapped roles so callers can compare `taken < cap`
// without special-casing. A weighted role never rounds below 1 — a role
// listed in the YAML should always be pickable by somebody, even at a small
// player count where round() would otherwise floor it to zero.
function roleCapacity(role, playerCount) {
  if (role.isUnique) return 1;
  if (role.unlimited) return Infinity;
  if (role.weight == null) return 1;
  return Math.max(1, Math.round((role.weight * playerCount) / 100));
}

function formatCapacity(cap) {
  return cap === Infinity ? "∞" : String(cap);
}

// Seats that never reopen. A seat is normally held only by a LIVING character
// — the holder dies and the picker offers the role again, which is right for
// a Bum or a Cerberus. These roles are the exception: once someone has held
// the seat it stays taken for the rest of the run, dead holder or not, so
// there is never a second Baron, a second Sheriff. That includes the roles
// with a single seat at 100 players (Diplomat, Sheriff) — Gunboat confirmed
// they are one-and-done.
//
// A slug list rather than a roles.yaml key + Role column, the same call the
// playtest lock made (web/lib/characterCreation.js#PLAYTEST_LOCKED_ROLE_SLUGS,
// CHARACTERS.md "Seat caps"): a static rule over a fixed roster, and a column
// would mean a live migration for a boolean. Keyed on Role.slug, so renaming
// a slug in the YAML silently drops the role from this list — same caveat
// the playtest lock carries.
const PERMANENT_SEAT_ROLE_SLUGS = [
  // The Court
  "baron",
  "baroness",
  "heir",
  "successor",
  "hand",
  "meister",
  "arbiter",
  // The Cerberon
  "censor",
  "incarn",
  // Town
  "bishop",
  "esculap",
  "inquisitor",
  "headman",
  "sheriff",
  "innkeeper",
  "brigand-leader",
  "brigand",
];

function isPermanentSeat(role) {
  return PERMANENT_SEAT_ROLE_SLUGS.includes(role?.slug);
}

// Which Character.status values occupy a seat of this role. The one
// definition behind every `taken` count — the wizard's picker, the seat
// reservation, and createCharacter's in-transaction race check — so they
// can never disagree about who is sitting in a chair. CURSED is in the enum
// but nothing writes it; listing statuses explicitly rather than dropping
// the filter keeps that true if it ever changes.
function seatHolderStatuses(role) {
  return isPermanentSeat(role) ? ["ALIVE", "DEAD"] : ["ALIVE"];
}

module.exports = { roleCapacity, formatCapacity, PERMANENT_SEAT_ROLE_SLUGS, isPermanentSeat, seatHolderStatuses };
