// Can the acting character physically reach the other end of a transfer?
//
// Distinct from db/lib/factionPermissions.js, which answers *may I* — this
// answers *can I get there*. A faction's Leader has authority over its Silo
// from anywhere on the map; that is not the same as being able to put ⬢ into
// it. Both gates apply, independently.
//
// Two grains, deliberately:
//
//   person -> person   same Location. A handoff is a room-scale act, and it
//                      matches the co-location gate HEAL_CHARACTER already
//                      enforces (REQUESTS.md §5c).
//   party  -> Silo     same Zone as the faction's silo zone, OR same Zone as
//                      one of its Leaders/Treasurers.
//
// The officer clause is what stops this soft-locking. Pinning a Silo to a
// building would let an occupying force paralyse a faction's treasury with no
// counterplay; pinning it to a zone with a mobile officer extension means a
// besieged fortress makes the tax run dangerous while an officer who rides out
// to meet you makes it easier. Leadership can always walk toward the problem.
//
// Lives in web/lib rather than db/lib because there is no bot surface for
// moving ⬢ at all — every path is web (COMMANDS.md lists no /give, /pay or
// /transfer). If a bot command ever appears, promote this to db/lib with the
// prisma-as-first-parameter convention factionPermissions.js uses.
import { prisma } from "@lifeweb/db";
import { getFactionAncestorIds } from "@/lib/factionPermissions";

// A character who hasn't been placed yet can't reach anything. Being nowhere
// is not the same as being everywhere, and the null would otherwise match
// every other unplaced character.
export function canReachCharacter(actor, target) {
  if (!actor?.locationId || !target?.locationId) return false;
  return actor.locationId === target.locationId;
}

// Zone-grain, and Character.zoneId is the right field to compare: it is the
// denormalized mirror of location.zoneId, written in the same update (MAP.md
// §1), so it never disagrees with locationId.
export async function canReachSilo(actor, faction) {
  if (!actor?.zoneId) return false;

  // The faction's own home zone — the warehouse you can walk up to.
  if (faction?.zoneId && faction.zoneId === actor.zoneId) return true;
  if (!faction?.id) return false;

  // Otherwise, an officer standing in the actor's zone speaks for the Silo.
  // Ancestors count for the same reason getSiloAccess lets them manage a
  // subject's Silo: authority flows downward, so a parent's Leader is a
  // legitimate mouth for a subject faction. Never the reverse.
  const ancestorIds = await getFactionAncestorIds(faction.id);
  const officers = await prisma.character.count({
    where: {
      status: "ALIVE",
      zoneId: actor.zoneId,
      factionId: { in: [faction.id, ...ancestorIds] },
      OR: [{ isLeader: true }, { isTreasurer: true }],
    },
  });
  return officers > 0;
}

// One entry point for both party kinds, so call sites don't branch. `party` is
// a resolveParty() result: { kind, id, name, balance, locationId?, zoneId? }.
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
  return `${where} and no ${party?.name} Leader or Treasurer is in your zone.`;
}
