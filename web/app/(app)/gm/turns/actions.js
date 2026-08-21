"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@lifeweb/db";
import { getGmSession } from "@/lib/discordGuild";
import { REQUEST_EFFECTS } from "@/lib/requestEffects";
import { UserError, guarded } from "@/lib/actionResult";

async function requireGm() {
  const { session, isGm: gm } = await getGmSession();
  if (!session?.discordUserId) throw new UserError("Not authenticated.");
  if (!gm) throw new UserError("Not authorized.");
  return session;
}

// The GM's verdict on a Request.
//   "confirm" -> apply the edits, mark EDITED
//   "undo"    -> invert request.effect, mark UNDONE
// Cancelling is purely client-side (the panel closes and discards), so it
// never reaches this action — a cancelled review leaves the row PASSED.
async function resolveRequestImpl({ requestId, mode, edits = {}, gmNotes }) {
  const session = await requireGm();
  if (!["confirm", "undo"].includes(mode)) throw new UserError("Unknown mode.");

  const result = await prisma.$transaction(async (tx) => {
    const request = await tx.request.findUnique({ where: { id: requestId } });
    if (!request) throw new UserError("Request not found.");

    const handler = REQUEST_EFFECTS[request.type];
    if (!handler) throw new UserError(`No handler for ${request.type}.`);

    const ctx = {
      actorDiscordUserId: session.discordUserId,
      actorName: "GM",
      turnNumber: null,
      turnPhase: null,
    };

    let note = "";
    let effect = request.effect;
    let status = request.status;

    if (mode === "undo") {
      // Idempotent on status: undoing an already-undone request must not
      // reverse the reversal, which would silently re-apply the effect.
      if (request.status === "UNDONE") {
        note = "Already undone — no changes made.";
      } else {
        note = (await handler.undo(tx, request, ctx)) ?? "Undone.";
        status = "UNDONE";
      }
    } else {
      if (request.status === "UNDONE") throw new UserError("That request was already undone.");
      if (handler.applyEdit) {
        const out = await handler.applyEdit(tx, request, edits, ctx);
        effect = out.effect ?? request.effect;
        note = out.note ?? "";
      } else {
        note = "No editable fields — marked reviewed.";
      }
      status = "EDITED";
    }

    const updated = await tx.request.update({
      where: { id: requestId },
      data: {
        status,
        effect,
        gmNotes: gmNotes?.toString().trim() || request.gmNotes,
        reviewedAt: new Date(),
        reviewedByDiscordUserId: session.discordUserId,
      },
    });

    await tx.auditLog.create({
      data: {
        actorDiscordUserId: session.discordUserId,
        actionType: mode === "undo" ? "request_undone" : "request_edited",
        targetCharacterId: request.characterId,
        reason: request.reason,
        details: { requestId, type: request.type, note },
      },
    });

    return { status: updated.status, note };
  });

  revalidatePath("/gm/turns");
  revalidatePath("/gm/audit");
  revalidatePath("/character");
  revalidatePath("/faction");
  return result;
}

// Wrapped so a GM sees "That request was already undone." rather than React
// error #441 — see web/lib/actionResult.js.
export async function resolveRequest(input) {
  return guarded(() => resolveRequestImpl(input));
}
