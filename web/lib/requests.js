import { prisma } from "@lifeweb/db";
import { MAX_REASON_LENGTH } from "@/lib/constants";
import { UserError } from "@/lib/actionResult";

// A Request is a change the player already made. There is no approval step:
// the effect is applied and the row is written in the same transaction, and a
// GM reviews it afterwards from /gm/turns. See docs/systemdocs/REQUESTS.md.

export { MAX_REASON_LENGTH };

// How many Dead Simple items a character may make in one turn.
//
// Dead Simple is the bottom rung of the smithing ladder (SMITHING.md §2) and
// the only one that costs 0 turns, so nothing was rationing it: a player could
// file Add Tag requests all turn and walk away with any number of work knives.
// The cap is on UNITS, not requests — the Dead Simple items are stackable and
// one request can carry a quantity of 20 — and it is summed across every
// ADD_TAG request the character has filed this turn.
export const DEAD_SIMPLE_PER_TURN = 4;

// The skills that mark a recipe as smithing/crafting work. Every smithing rung
// counts, not just the one Dead Simple actually gates on, so a future 0-turn
// recipe at a higher rung is covered without editing this list.
const DEAD_SIMPLE_SKILL_SLUGS = (slug) => slug === "crafting" || slug.startsWith("smithing");

// There is no "tier" column — Dead Simple is only a comment header in
// docs/tags.yaml — so the tier is recognised by its recipe: 0 turns of work,
// and a smithing or crafting skill gate. That is exactly the ten craftables
// under the Dead Simple headers today. The one other tag in the catalog with
// `turnsCost: 0` is Frostbite, whose requirement block is a CURE (medical
// skills, the removal direction), so the skill test keeps it out.
//
// `tag.requirementSkills` must be loaded ({ slug }) or this reads false.
export function isDeadSimple(tag) {
  if (tag?.requirementTurns !== 0) return false;
  return (tag.requirementSkills ?? []).some((skill) => DEAD_SIMPLE_SKILL_SLUGS(skill.slug));
}

// Defined in requestLabels.js so client components can have them without
// pulling this module's Prisma import into the browser bundle.
export { REQUEST_TYPE_LABELS, REQUEST_STATUS_LABELS, REQUEST_STATUS_TONES } from "@/lib/requestLabels";

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
