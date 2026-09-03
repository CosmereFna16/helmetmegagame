import { zoneKey } from "@/lib/zones";

// The zone a row belongs to, as a chip.
//
// What it shows is the zone the character's FACTION is keyed to
// (Faction.zoneId), never where they happen to be standing
// (Character.zoneId) — a Courtier is Fortress whether or not they are in
// the Fortress. Callers pass a flat `factionZoneName` string for that reason;
// getting the two zones confused is the one real bug this component invites.
//
// No "use client": a leaf with no handlers, so it stays server-rendered inside
// /gm/dev/factions and /faction, which are server components.
export default function ZoneChip({ zoneName }) {
  const key = zoneKey(zoneName);
  if (!zoneName) {
    return (
      <span className="chip zone-chip" data-zone="none">
        <span aria-hidden="true">—</span>
        <span className="sr-only">No faction zone</span>
      </span>
    );
  }
  // A name we do not recognise still renders, just uncoloured — a renamed zone
  // should look unfamiliar, not disappear.
  return (
    <span className="chip zone-chip" data-zone={key ?? "none"}>
      {zoneName}
    </span>
  );
}
