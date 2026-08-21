"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@lifeweb/db";
import { getGmSession, killCharacter } from "@/lib/discordGuild";
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

// A Feed Person request never kills anyone on its own — letting a player end
// another player's game from a dropdown is the abuse that design avoids. This
// is the GM closing that loop from the Requests tab instead, running the same
// death path as the character editor (gm/dev/actions.js): status DEAD, then
// killCharacter() to delete the personal Discord role (which takes the
// Location and narrowcast overwrites with it), clear the nickname and grant
// Cursed.
async function killRequestTargetImpl({ requestId }) {
  const session = await requireGm();

  const request = await prisma.request.findUnique({ where: { id: requestId } });
  if (!request) throw new UserError("Request not found.");
  if (request.type !== "FEED_PERSON") throw new UserError("That request doesn't name someone to kill.");

  const effect = request.effect ?? {};
  if (effect.killed) throw new UserError("They've already been killed.");

  const target = await prisma.character.findUnique({ where: { id: effect.targetCharacterId ?? "" } });
  if (!target) throw new UserError("That character no longer exists.");
  if (target.status === "DEAD") throw new UserError(`${target.name} is already dead.`);

  const updated = await prisma.character.update({
    where: { id: target.id },
    data: { status: "DEAD" },
  });

  await killCharacter(updated).catch((err) => console.error("killCharacter failed:", err));

  await prisma.request.update({
    where: { id: requestId },
    data: { effect: { ...effect, killed: true, killedAt: new Date().toISOString() } },
  });

  await prisma.auditLog.create({
    data: {
      actorDiscordUserId: session.discordUserId,
      actionType: "request_feed_person_killed",
      targetCharacterId: target.id,
      reason: request.reason,
      details: { requestId, targetName: target.name },
    },
  });

  revalidatePath("/gm/turns");
  revalidatePath("/gm/players");
  revalidatePath("/gm/audit");
  revalidatePath("/lifeweb");
  return { targetName: target.name };
}

// Wrapped so a GM sees "That request was already undone." rather than React
// error #441 — see web/lib/actionResult.js.
export async function resolveRequest(input) {
  return guarded(() => resolveRequestImpl(input));
}

export async function killRequestTarget(input) {
  return guarded(() => killRequestTargetImpl(input));
}
