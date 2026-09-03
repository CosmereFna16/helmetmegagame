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
import { accessibleRooms, heldTagSlugs } from "@lifeweb/db/lib/roomAccess";
import { isHere } from "@/lib/peopleHere";

// `party` is a resolveParty() result. `heldSlugs` may be passed to save the
// lookup when the caller has it.
export async function canReachParty(actor, party, { heldSlugs = null, allowDead = false } = {}) {
  if (!party) return false;
  if (party.kind === "room") {
    if (!actor?.locationId || party.locationId !== actor.locationId) return false;
    const held = heldSlugs ?? (await heldTagSlugs(prisma, actor.id));
    return accessibleRooms([party], held).length === 1;
  }
  if (party.kind === "character") return isHere(actor, party, { allowDead });
  return false;
}

// Kept beside the gate so every call site fails with the same words.
export function outOfReachMessage(party) {
  if (party?.kind === "room") return `You can't get into ${party.name} from where you stand. ‡`;
  return `${party?.name ?? "They"} isn't here. ‡`;
}
