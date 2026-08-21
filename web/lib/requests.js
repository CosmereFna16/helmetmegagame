import { prisma } from "@lifeweb/db";
import { MAX_REASON_LENGTH } from "@/lib/constants";
import { UserError } from "@/lib/actionResult";

// A Request is a change the player already made. There is no approval step:
// the effect is applied and the row is written in the same transaction, and a
// GM reviews it afterwards from /gm/turns. See docs/systemdocs/REQUESTS.md.

export { MAX_REASON_LENGTH };

export const REQUEST_TYPE_LABELS = {
  FULFILL_DESIRE: "Fulfill Desire",
  ADD_TAG: "Add Tag",
  REMOVE_TAG: "Remove Tag",
  TRANSFER_RESOURCES: "Transfer Resources",
  TRANSFER_TAG: "Transfer Tag",
  SET_MOOD: "Set Mood",
  DONATE_BLOOD: "Donate Blood",
  FEED_PERSON: "Feed Person",
};

export const REQUEST_STATUS_LABELS = {
  PASSED: "Passed",
  EDITED: "Edited",
  UNDONE: "Undone",
};

// Server actions are public endpoints, so the reason is validated here rather
// than trusted from the dialog that collected it.
export function requireReason(raw) {
  const reason = raw?.toString().trim() ?? "";
  if (!reason) throw new UserError("A reason is required.");
  return reason.slice(0, MAX_REASON_LENGTH);
}

// `payload` is what the player asked for; `effect` is what was actually
// applied. Undo reads ONLY `effect` — see the model comment in schema.prisma
// for why re-deriving from live state is unsafe.
export function createRequest(tx, { characterId, turnId, type, reason, payload, effect }) {
  return tx.request.create({
    data: {
      characterId,
      turnId: turnId ?? null,
      type,
      reason,
      payload: payload ?? {},
      effect: effect ?? {},
    },
  });
}

// Every request writes an AuditLog row too, carrying the same reason — that's
// what fills the Reason column on /gm/audit.
export function logRequest(tx, { actorDiscordUserId, actionType, targetCharacterId, reason, details }) {
  return tx.auditLog.create({
    data: {
      actorDiscordUserId,
      actionType,
      targetCharacterId: targetCharacterId ?? null,
      reason,
      details: details ?? {},
    },
  });
}

export async function getOpenTurnId() {
  const turn = await prisma.turn.findFirst({ where: { status: "OPEN" }, select: { id: true, number: true } });
  return turn ?? null;
}
