// The post-commit tail of every server action that changes what a character
// holds — tags or ⬢. One helper so no writer forgets a step, and so the
// steps run in the one order that is correct:
//
//   1. settleCarry — Overburdened on/off, and the overflow drop when a Cart
//      or Pack Mule just left (db/lib/carry.js, CARRY.md). FIRST, because a
//      drop can take a private-room key off the sheet.
//   2. narrowcast + room access — recomputed from the post-drop holdings.
//   3. the drop's Discord work, in after(), off the request's critical path.
//   4. corpse follow — a body that changed hands is a body that moved, and
//      the dead sheet has to catch up before anyone tries to loot it
//      (db/lib/corpseFollow.js, CORPSES.md).
//
// Everything is best-effort and catch-logged: a missed sync is the channel
// doctor's problem (CHANNELS.md §6) and a missed settle self-heals at the
// next one. Never call this inside a transaction.
import { after } from "next/server";
import { prisma } from "@lifeweb/db";
import { settleCarry, deliverCarryDrop } from "@lifeweb/db/lib/carry";
import { syncCharacterRoomAccess } from "@lifeweb/db/lib/roomAccess";
import { reconcileCorpses } from "@lifeweb/db/lib/corpseFollow";
import { syncCharacterNarrowcastAccess } from "@/lib/discordGuild";

// `characters`: ids or rows (anything with `.id`), one or many. Rows are
// re-read rather than trusted — several call sites hold a row loaded before
// their own transaction ran, and the settle may have changed it again.
export async function afterInventoryChange(characters) {
  const ids = [...new Set([].concat(characters).filter(Boolean).map((c) => (typeof c === "string" ? c : c.id)))];
  for (const id of ids) {
    const settled = await settleCarry(prisma, id).catch((err) => {
      console.error(`settleCarry failed for ${id}:`, err);
      return null;
    });
    const row = await prisma.character
      .findUnique({ where: { id }, select: { id: true, discordUserId: true, locationId: true, status: true } })
      .catch(() => null);
    await syncCharacterNarrowcastAccess(id).catch(() => {});
    if (row) await syncCharacterRoomAccess(prisma, row).catch(() => {});
    if (settled?.drop) after(() => deliverCarryDrop(prisma, settled).catch(() => {}));
  }
  // Once, after the whole batch: a transfer moves a corpse between two
  // characters and both ends are in `ids`, so per-id would just do it twice.
  if (ids.length) await reconcileCorpses(prisma).catch((err) => console.error("corpse follow failed:", err));
}
