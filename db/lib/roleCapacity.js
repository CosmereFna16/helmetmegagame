// Seat math for a Role, shared by the character-creation picker, the
// createCharacter server action's race check, and the GM panel — so all
// three agree on what "full" means.
//
// The three shapes come straight from docs/roles.yaml's multiple/weight
// pair (see Role in schema.prisma):
//   isUnique  -> exactly 1 seat, at any game size. A single named character
//                (Baron, Bishop, Headman) — NOT the same as "1 per 100".
//   unlimited -> uncapped chaff roles (Peasant, Bum, Migrant).
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

module.exports = { roleCapacity, formatCapacity };
