// Can the acting character physically reach the other end of a transfer, a
// heal, a craft's payer?
//
// Both party kinds are Location-grain: a person has to be standing where you
// are and not concealed (web/lib/peopleHere.js#isHere — the one predicate
// every people-picker and every server re-check share), and a Room has to be
// at your Location with its door open for you — the same accessibleRooms()
// predicate the thread-membership sync uses, so the transfer gate and the
// door can never disagree about The Charon.
import { prisma } from "@lifeweb/db";
import { accessibleRooms, roomAccessKeys } from "@lifeweb/db/lib/roomAccess";
import { isHere } from "@/lib/peopleHere";

// The one exception to Location-grain reach: your own faction's silo.
//
// A silo is a Room a faction banks in (Faction.siloRoomId, FACTIONS.md), and
// putting things IN one works from anywhere in that room's zone — you walk
// your loot home to the district, not to the exact door. Taking things OUT
// keeps the ordinary rule, so a silo stays a place somebody has to go, and so
// an occupied storeroom is actually occupied.
//
// Note what this deliberately does NOT check: `accessibleRooms`. Five of the
// silos are locked, and a member without the key can still post goods into
// one — a mail slot. They can never open it, which the deposit control says
// out loud (FactionConsole.js). Refusing the deposit instead would make a
// locked silo useless to everybody but the key-holder.
export async function isOwnFactionSilo(actor, party) {
  if (!actor?.factionId || !actor?.zoneId) return false;
  if (party.zoneId !== actor.zoneId) return false;
  const faction = await prisma.faction.findFirst({
    where: { id: actor.factionId, siloRoomId: party.id },
    select: { id: true },
  });
  return Boolean(faction);
}

// `party` is a resolveParty() result. `heldSlugs` and `guestRoomIds` may be
// passed to save the lookup when the caller has them; a room needs BOTH, so
// half an answer is re-read rather than trusted.
//
// `direction` says which END of a transfer this is — "to" for the recipient,
// "from" for the source. It exists only for the silo rule above; leaving it
// unset gives the strict, pre-silo answer, which is what every caller that
// isn't a two-ended transfer wants.
export async function canReachParty(
  actor,
  party,
  { heldSlugs = null, guestRoomIds = null, allowDead = false, direction = null } = {},
) {
  if (!party) return false;
  if (party.kind === "room") {
    if (direction === "to" && (await isOwnFactionSilo(actor, party))) return true;
    if (!actor?.locationId || party.locationId !== actor.locationId) return false;
    const keys =
      heldSlugs && guestRoomIds ? { heldSlugs, guestRoomIds } : await roomAccessKeys(prisma, actor.id);
    return accessibleRooms([party], keys.heldSlugs, keys.guestRoomIds).length === 1;
  }
  if (party.kind === "character") return isHere(actor, party, { allowDead });
  return false;
}

// Kept beside the gate so every call site fails with the same words.
//
// `isSilo` splits the room message in two: "you can't get in" is wrong for a
// silo you can plainly deposit into from across the zone, and a player told
// that would go looking for a key they don't need.
export function outOfReachMessage(party, { isSilo = false } = {}) {
  if (party?.kind === "room" && isSilo) {
    return `Your silo is in ${party.name} — you have to be standing there to take anything out. ‡`;
  }
  if (party?.kind === "room") return `You can't get into ${party.name} from where you stand. ‡`;
  return `${party?.name ?? "They"} isn't here. ‡`;
}
