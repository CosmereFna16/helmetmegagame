// Who a character can act on from their sheet: the people standing at the
// same Location who haven't hidden their face — and, for the actions that
// work on a body, the unburied dead.
//
// This is the ONE roster behind every people-picker on /character (Transfer,
// Heal and its payer, Craft's payer, Loot, Move Player, Bind, Free, Harm,
// Learn, Teach), and `isHere` is the server-side re-check every one of
// those actions runs on a posted id. They read the same predicate
// (db/lib/presence.js) so the menu and the gate can't disagree.
//
// This replaced the old rule that menus list every living player so nobody
// learns who is nearby. The button-greying rule (never grey a button for a
// fact about who is near you — ActionGrid.js) still stands on top.
import { prisma } from "@lifeweb/db";
import { hereWhere } from "@lifeweb/db/lib/presence";

export { hereWhere, isHere, HERE_FIELDS, notHereMessage } from "@lifeweb/db/lib/presence";

// Everyone here, name-sorted, with the caller's `select`. Nowhere is
// nobody: an unplaced character reaches no one.
export async function peopleHere(character, { includeDead = false, select } = {}) {
  if (!character?.locationId) return [];
  return prisma.character.findMany({
    where: hereWhere(character, { includeDead }),
    orderBy: [{ firstName: "asc" }, { lastName: { sort: "asc", nulls: "first" } }],
    select,
  });
}
