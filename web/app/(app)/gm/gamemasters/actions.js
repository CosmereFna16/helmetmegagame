"use server";

import { revalidatePath } from "next/cache";
import { TURNS_PATH } from "@/lib/routes";
import { prisma } from "@lifeweb/db";
import { auth } from "@/lib/auth";
import { isSuperadmin } from "@/lib/superadmin";
import { getGuildMember, isGm } from "@/lib/discordGuild";
import { UserError, guarded } from "@/lib/actionResult";

async function requireSuperadmin() {
  const session = await auth();
  if (!session?.discordUserId || !isSuperadmin(session.discordUserId)) {
    throw new UserError("Not authorized.");
  }
  return session;
}

// Seat a GM in zero or more zones. The array IS the seat set — it replaces
// whatever was there, and an empty one clears every seat.
//
// A server action is a public endpoint, so every gate the UI applied is
// re-applied here: the caller is the superadmin, the TARGET actually holds the
// GM role, and every zone is a real SEAT zone. Without the target check this
// endpoint would happily seat any Discord ID a caller invented — the picker
// being superadmin-only is a hint, not the lock. Without the CAVE_LEVEL check
// a caller could seat a GM on the Railroad, which no row is ever stamped with.
// Every refusal below is a UserError, and the export is wrapped in guarded(),
// so the reason reaches the screen as data. They were plain Errors, and Next
// redacts anything thrown out of a Server Action into React error #441 — so
// GmZonePicker's catch, which is genuinely written to display e.message,
// showed a digest where it should have said "That member does not hold the GM
// role." The check was doing its job; only the explanation was lost.
async function assignGmZonesImpl({ discordUserId, zoneIds }) {
  const session = await requireSuperadmin();

  const targetId = String(discordUserId ?? "").trim();
  if (!/^\d{5,25}$/.test(targetId)) throw new UserError("That isn't a Discord user ID.");

  const member = await getGuildMember(targetId);
  if (!isGm(member)) throw new UserError("That member does not hold the GM role.");

  // De-duplicated, because the same id twice would violate the composite key
  // rather than mean anything.
  const wanted = [...new Set((Array.isArray(zoneIds) ? zoneIds : []).map((z) => String(z ?? "").trim()).filter(Boolean))];

  let zones = [];
  if (wanted.length > 0) {
    zones = await prisma.zone.findMany({
      where: { id: { in: wanted } },
      select: { id: true, name: true, kind: true },
    });
    if (zones.length !== wanted.length) throw new UserError("No such zone.");
    if (zones.some((z) => z.kind === "CAVE_LEVEL")) {
      throw new UserError("A seat is a zone, not one level of the Depths — pick Caves.");
    }
  }

  // Replace the whole set in one transaction. Absence of a row IS "no seat",
  // so clearing is just the delete with nothing to follow it.
  await prisma.$transaction([
    prisma.gmAssignment.deleteMany({ where: { discordUserId: targetId } }),
    ...(zones.length > 0
      ? [
          prisma.gmAssignment.createMany({
            data: zones.map((z) => ({
              discordUserId: targetId,
              zoneId: z.id,
              assignedByDiscordUserId: session.discordUserId,
            })),
          }),
        ]
      : []),
  ]);

  await prisma.auditLog.create({
    data: {
      actorDiscordUserId: session.discordUserId,
      actionType: "superadmin_gm_zones_assigned",
      details: {
        targetDiscordUserId: targetId,
        zoneIds: zones.map((z) => z.id),
        // Names too, so the audit line still reads years after a zone rename.
        zoneNames: zones.map((z) => z.name),
      },
    },
  });

  // The seats pick the default filter on every GM table, so they all go stale
  // together.
  revalidatePath("/gm/gamemasters");
  // The player desk's rail lives in its layout, and a page path does not
  // invalidate what is below it — so a GM sitting in a conversation would
  // never see the reseated filter without "layout".
  revalidatePath("/gm/players", "layout");
  revalidatePath(TURNS_PATH, "page");
}

export async function assignGmZones(input) {
  return guarded(() => assignGmZonesImpl(input));
}
