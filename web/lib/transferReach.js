// Can the acting character physically reach the other end of a transfer?
//
// Distinct from db/lib/factionPermissions.js, which answers *may I* — this
// answers *can I get there*. A faction's Leader has authority over its Silo
// from anywhere on the map; that is not the same as being able to put ⬢ into
// it. Both gates apply, independently.
//
// person -> person is a same-zone handoff (REQUESTS.md §5c's co-presence
// gate); party -> Silo requires standing in the faction's own silo seat
// zone, full stop — no officer standing elsewhere extends it, or a besieged
// faction could be paid by an officer collecting from outside the walls.
import { prisma, seatZoneIdFor } from "@lifeweb/db";

// A character who hasn't been placed yet can't reach anything. Being nowhere
// is not the same as being everywhere, and the null would otherwise match
// every other unplaced character.
export function canReachCharacter(actor, target) {
  if (!actor?.zoneId) return false;
  return actor.zoneId === target?.zoneId;
}

// Zone-grain. Character.zoneId is the PRESENCE zone (a surface zone or a
// single cave level); a faction's silo seat is a SEAT zone, which for the
// whole cave system is the Caves group row. So this compares seat to seat —
// someone standing on the Railroad is standing in the Caves faction's zone.
//
// `siloZoneId ?? zoneId`, because a faction can group under one zone and bank
// in another (the Bastard's Camp and the Windrider Clan are Windlands but
// bank in Town). Takes both a resolveParty() result — where db/lib/parties.js
// has already collapsed the two into `zoneId` — and a bare Faction row from
// /faction, which has not.
export async function canReachSilo(actor, faction) {
  if (!actor?.zoneId) return false;

  const siloZoneId = faction?.siloZoneId ?? faction?.zoneId;

  // The faction's own silo zone — the warehouse you can walk up to. Loaded
  // rather than taken off `actor` because callers hand us a bare character
  // row, and seatZoneId only lives on Zone.
  if (siloZoneId) {
    const actorZone = await prisma.zone.findUnique({
      where: { id: actor.zoneId },
      select: { id: true, parentZoneId: true, seatZoneId: true },
    });
    if (siloZoneId === seatZoneIdFor(actorZone)) return true;
  }
  return false;
}

// One entry point for both party kinds, so call sites don't branch. `party` is
// a resolveParty() result: { kind, id, name, balance, zoneId? }.
export async function canReachParty(actor, party) {
  if (!party) return false;
  if (party.kind === "character") {
    // Reaching yourself is free — you are always where you are.
    if (party.id === actor?.id) return true;
    return canReachCharacter(actor, party);
  }
  return canReachSilo(actor, party);
}

// Kept beside the gate so every call site fails with the same words.
export function outOfReachMessage(party, zoneName) {
  if (party?.kind === "character") return `${party.name} isn't here.`;
  const where = zoneName ? `You're not in ${zoneName}` : `You're nowhere near ${party?.name}`;
  return `${where}.`;
}
