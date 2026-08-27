// The one way to turn a zone into the zone that OWNS it — the GM-seat key.
//
// Presence is six zones (three surface + three cave levels); the GM seats,
// factions and every stamped Action/Note/DefaultEffort/StagedMessage zoneId
// stay at four, with the whole cave system belonging to the Caves seat. That
// mapping is denormalized onto Zone.seatZoneId by the sync
// (parentZoneId ?? id), and this helper is the single reader every writer
// goes through — never reach for zone.id when stamping a seat-scoped row, or
// a character acting on the Railroad files work no Caves GM can see.
//
// The channel doctor checks the invariant from the other side: no stamped
// zoneId may point at a CAVE_LEVEL row.
function seatZoneIdFor(zone) {
  if (!zone) return null;
  return zone.seatZoneId ?? zone.parentZoneId ?? zone.id;
}

module.exports = { seatZoneIdFor };
