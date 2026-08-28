// Can the acting character physically reach the other end of a transfer?
//
// Distinct from db/lib/factionPermissions.js, which answers *may I* — this
// answers *can I get there*. A faction's Leader has authority over its Silo
// from anywhere on the map; that is not the same as being able to put ⬢ into
// it. Both gates apply, independently.
//
// Two grains, but now both resolve to the same rule:
//
//   person -> person   same presence zone. A handoff is a face-to-face act,
//                      and it matches the co-presence gate HEAL_CHARACTER
//                      already enforces (REQUESTS.md §5c).
//   party  -> Silo     the faction's own seat zone. Full stop.
//
// The officer clause — an actor's zone counting if a Leader or Treasurer of
// the faction was standing there too — has been REMOVED. It let an officer
// who rode out to meet a payer keep the Silo reachable from anywhere the
// officer happened to be, which is exactly backwards during a siege: a
// besieged faction should not be payable by sending an officer to go collect
// from outside the walls. Treasury access is now tied to physically holding
// the seat zone, with no mobile extension of it.
//
// Lives in web/lib rather than db/lib because there is no bot surface for
// moving ⬢ at all — every path is web (COMMANDS.md lists no /give, /pay or
// /transfer). If a bot command ever appears, promote this to db/lib with the
// prisma-as-first-parameter convention factionPermissions.js uses.
import { prisma, seatZoneIdFor } from "@lifeweb/db";

// A character who hasn't been placed yet can't reach anything. Being nowhere
// is not the same as being everywhere, and the null would otherwise match
// every other unplaced character.
export function canReachCharacter(actor, target) {
  if (!actor?.zoneId) return false;
  return actor.zoneId === target?.zoneId;
}

// Zone-grain. Character.zoneId is the PRESENCE zone (a surface zone or a
// single cave level); Faction.zoneId is the SEAT zone, which for the whole
// cave system is the Caves group row. So this compares seat to seat —
// someone standing on the Railroad is standing in the Caves faction's zone.
export async function canReachSilo(actor, faction) {
  if (!actor?.zoneId) return false;

  // The faction's own home zone — the warehouse you can walk up to. Loaded
  // rather than taken off `actor` because callers hand us a bare character
  // row, and seatZoneId only lives on Zone.
  if (faction?.zoneId) {
    const actorZone = await prisma.zone.findUnique({
      where: { id: actor.zoneId },
      select: { id: true, parentZoneId: true, seatZoneId: true },
    });
    if (faction.zoneId === seatZoneIdFor(actorZone)) return true;
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
