// The turn economy, such as it is.
//
// There is no `turnsRemaining` column anywhere. "Has this character acted
// this turn" is entirely "does an Action row exist for (characterId, the open
// Turn)" — the check the bot's Move modal, db/lib/travel.js and
// bot/src/lib/labor.js each make independently. Everything here follows from
// that one fact, and it is why giving a turn back means DELETING a row rather
// than flipping a flag.
//
// Extracted from gm/turns/actions.js#rejectMoveImpl so the Dev Panel's
// Restore-turn button and the Moves panel's Reject share one definition.
// Two copies would drift the first time Action.appliedEffects grows a key.
import { revertMoveEffects } from "@lifeweb/db";

// A cooperative lock, not a status — see the comment on MOVE_LOCK_TTL_MS in
// gm/turns/actions.js. Exported so anything that mutates a Move can honour a
// lock without re-deriving the predicate.
export const MOVE_LOCK_TTL_MS = 90_000;

export function lockIsLive(action, now = new Date()) {
  return Boolean(action.lockExpiresAt && action.lockExpiresAt > now);
}

// The open turn's Action for one character, or null. `null` is the answer to
// "can they still act" — there is nothing else to consult.
export async function findOpenTurnAction(prisma, characterId) {
  const openTurn = await prisma.turn.findFirst({
    where: { status: "OPEN" },
    select: { id: true, number: true, phase: true },
  });
  if (!openTurn) return { openTurn: null, action: null };

  const action = await prisma.action.findFirst({
    where: { characterId, turnId: openTurn.id },
    include: { character: true },
  });
  return { openTurn, action };
}

// Deletes the Action, clawing back anything it already pushed first.
//
// A Routine's resources land the moment the player confirms
// (ADJUDICATION.md §5), so deleting the row without reverting would leave the
// player holding ⬢ from a Move that no longer exists. revertMoveEffects reads
// ONLY the appliedEffects snapshot, never the live row, so it stays correct
// even for a Move a GM edited in between.
//
// Takes a transaction client: both callers do this alongside an audit write
// that must not commit separately.
export async function deleteActionRestoringTurn(tx, action) {
  if (action.appliedEffects) await revertMoveEffects(tx, action);
  await tx.action.delete({ where: { id: action.id } });
}
