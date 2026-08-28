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

// Seat a GM in a zone, or clear their seat with a null/empty zoneId.
//
// A server action is a public endpoint, so every gate the UI applied is
// re-applied here: the caller is the superadmin, the TARGET actually holds the
// GM role, and the zone is real. Without the target check this endpoint would
// happily seat any Discord ID a caller invented — the picker being
// superadmin-only is a hint, not the lock.
// Every refusal below is a UserError, and the export is wrapped in guarded(),
// so the reason reaches the screen as data. They were plain Errors, and Next
// redacts anything thrown out of a Server Action into React error #441 — so
// GmZonePicker's catch, which is genuinely written to display e.message,
// showed a digest where it should have said "That member does not hold the GM
// role." The check was doing its job; only the explanation was lost.
async function assignGmZoneImpl({ discordUserId, zoneId }) {
  const session = await requireSuperadmin();

  const targetId = String(discordUserId ?? "").trim();
  if (!/^\d{5,25}$/.test(targetId)) throw new UserError("That isn't a Discord user ID.");

  const member = await getGuildMember(targetId);
  if (!isGm(member)) throw new UserError("That member does not hold the GM role.");

  const wanted = String(zoneId ?? "").trim();
  if (wanted) {
    const zone = await prisma.zone.findUnique({ where: { id: wanted }, select: { id: true } });
    if (!zone) throw new UserError("No such zone.");
  }

  if (wanted) {
    await prisma.gmAssignment.upsert({
      where: { discordUserId: targetId },
      update: { zoneId: wanted, assignedByDiscordUserId: session.discordUserId },
      create: {
        discordUserId: targetId,
        zoneId: wanted,
        assignedByDiscordUserId: session.discordUserId,
      },
    });
  } else {
    // Absence of a row IS "no seat", so clearing deletes rather than nulling.
    // P2025 (nothing to delete) is the already-clear case, not an error.
    await prisma.gmAssignment.delete({ where: { discordUserId: targetId } }).catch((e) => {
      if (e?.code !== "P2025") throw e;
    });
  }

  await prisma.auditLog.create({
    data: {
      actorDiscordUserId: session.discordUserId,
      actionType: "superadmin_gm_zone_assigned",
      details: { targetDiscordUserId: targetId, zoneId: wanted || null },
    },
  });

  // The seat picks the default filter on every GM table, so they all go stale
  // together.
  revalidatePath("/gm/gamemasters");
  // The player desk's rail lives in its layout, and a page path does not
  // invalidate what is below it — so a GM sitting in a conversation would
  // never see the reseated filter without "layout".
  revalidatePath("/gm/players", "layout");
  revalidatePath(TURNS_PATH, "page");
}

export async function assignGmZone(input) {
  return guarded(() => assignGmZoneImpl(input));
}
