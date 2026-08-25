"use server";

import { revalidatePath } from "next/cache";
import { Prisma, prisma, applyMoveEffects, revertMoveEffects, describeMoveEffects, rollDie } from "@lifeweb/db";
import { gambitModifierTotal } from "@lifeweb/db/lib/gambitModifier";
import { getGmSession, killCharacter, listGuildMembers, sendDm } from "@/lib/discordGuild";
import { REQUEST_EFFECTS } from "@/lib/requestEffects";
import { requireReason } from "@/lib/requests";
import { UserError, guarded } from "@/lib/actionResult";
import { deleteActionRestoringTurn } from "@/lib/moveEconomy";

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

// ---------------------------------------------------------------------------
// Moves
// ---------------------------------------------------------------------------

// A cooperative lock, not a status. Two GMs working the same queue must not
// adjudicate the same Move, but a lock that lives in moveReviewStatus strands
// the row forever the moment someone's browser dies. So the lock is its own
// pair of columns with a short TTL the open panel refreshes; "In Progress" is
// derived from a live lock. Nothing can get stuck — the worst case is a GM
// waits out MOVE_LOCK_TTL_MS.
const MOVE_LOCK_TTL_MS = 90_000;

function lockIsLive(action, now = new Date()) {
  return Boolean(action.lockExpiresAt && action.lockExpiresAt > now);
}

// The claim is one conditional write, not read-check-write.
//
// It used to read the row, decide the lock was free, and write -- so two GMs
// clicking the same row inside the same second both read "free", both wrote,
// and the second silently took a lock the first believed it held. Neither was
// told. The heartbeat and the release below were always conditional; this was
// the one that wasn't, which is the one that matters.
//
// The three OR arms are the whole rule: nobody holds it, I already hold it
// (re-opening my own panel), or whoever held it let the 90s TTL lapse.
async function claimMoveLockImpl({ actionId }) {
  const session = await requireGm();

  const { count } = await prisma.action.updateMany({
    where: {
      id: actionId ?? "",
      OR: [
        { lockedByDiscordUserId: null },
        { lockedByDiscordUserId: session.discordUserId },
        { lockExpiresAt: null },
        { lockExpiresAt: { lte: new Date() } },
      ],
    },
    data: {
      lockedByDiscordUserId: session.discordUserId,
      lockExpiresAt: new Date(Date.now() + MOVE_LOCK_TTL_MS),
    },
  });

  if (!count) {
    // Losing the race and the row being gone are indistinguishable from the
    // count alone, so read once -- off the hot path -- to say which.
    const action = await prisma.action.findUnique({ where: { id: actionId ?? "" } });
    if (!action) throw new UserError("Move not found.");
    const holder = await lockHolderName(action.lockedByDiscordUserId);
    throw new UserError(`${holder} is adjudicating this Move.`);
  }

  revalidatePath("/gm/turns");
  return { ttlMs: MOVE_LOCK_TTL_MS };
}

async function lockHolderName(discordUserId) {
  if (!discordUserId) return "Another GM";
  const members = await listGuildMembers().catch(() => []);
  return members.find((m) => m.id === discordUserId)?.username ?? "Another GM";
}

// The heartbeat. Extends only a lock this GM still holds — if it was taken
// over after expiry, say so rather than silently stealing it back.
async function refreshMoveLockImpl({ actionId }) {
  const session = await requireGm();
  const { count } = await prisma.action.updateMany({
    where: { id: actionId ?? "", lockedByDiscordUserId: session.discordUserId },
    data: { lockExpiresAt: new Date(Date.now() + MOVE_LOCK_TTL_MS) },
  });
  if (!count) throw new UserError("Your hold on this Move expired.");
  return {};
}

async function releaseMoveLockImpl({ actionId }) {
  const session = await requireGm();
  await prisma.action.updateMany({
    where: { id: actionId ?? "", lockedByDiscordUserId: session.discordUserId },
    data: { lockedByDiscordUserId: null, lockExpiresAt: null },
  });
  revalidatePath("/gm/turns");
  return {};
}

// Everything a GM can change about a Move before resolving it. Kind is the
// interesting one: a Gambit always carries a fresh roll and a Routine never
// carries one, so switching either way rewrites the dice rather than leaving a
// stale number behind (the invariant ADJUDICATION.md §5 asked to restore).
function normalizeEdits(action, edits, characterTags) {
  const data = {};

  const kind = edits.moveKind === "GAMBIT" || edits.moveKind === "ROUTINE" ? edits.moveKind : action.moveKind;
  if (kind !== action.moveKind) {
    data.moveKind = kind;
    if (kind === "ROUTINE") {
      data.diceRoll = null;
      data.diceModifier = null;
    } else {
      // Rolled from the character's CURRENT tags — a Mood that lapsed between
      // submission and adjudication shouldn't haunt a roll made today.
      data.diceRoll = rollDie();
      data.diceModifier = gambitModifierTotal(characterTags);
    }
  }

  data.opposed = Boolean(edits.opposed);
  data.resourceDelta = clampResourceDelta(edits.resourceDelta, action.resourceDelta);
  data.resultMessage = edits.resultMessage?.toString().trim() || null;
  data.gmNotes = edits.gmNotes?.toString().trim() || null;
  return data;
}

// Signed, unlike a request's cost — a Move can take resources away. Capped
// either side so a slipped keystroke can't hand out a fortune.
const MAX_RESOURCE_DELTA = 20;

function clampResourceDelta(raw, fallback) {
  if (raw === "" || raw == null) return null;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return fallback ?? null;
  return Math.max(-MAX_RESOURCE_DELTA, Math.min(MAX_RESOURCE_DELTA, n));
}

// mode "save"    -> keep the edits, hand the Move back to the queue
// mode "solve"   -> keep the edits, push the effects, mark SOLVED
// mode "unsolve" -> hand back everything that was pushed, return to the queue
async function resolveMoveImpl({ actionId, mode, edits = {}, notifyPlayer = false }) {
  const session = await requireGm();
  if (!["save", "solve", "unsolve"].includes(mode)) throw new UserError("Unknown mode.");

  const action = await prisma.action.findUnique({
    where: { id: actionId ?? "" },
    include: { character: { include: { tags: { include: { tag: true } } } } },
  });
  if (!action) throw new UserError("Move not found.");
  if (lockIsLive(action) && action.lockedByDiscordUserId !== session.discordUserId) {
    throw new UserError(`${await lockHolderName(action.lockedByDiscordUserId)} is adjudicating this Move.`);
  }

  // Every branch below opens by moving moveReviewStatus with a CONDITIONAL
  // write, so the check and the transition are one statement.
  //
  // The lock above says "someone is in this right now" and expires after 90s;
  // it was never the thing stopping a Move being solved twice, and nothing
  // else was either. Solve pushed its resources without ever asking whether
  // the row was already SOLVED, so two GMs on the same row -- or one GM on a
  // tab whose row data was rendered before the other finished -- both paid
  // out. The second push then overwrote appliedEffects with its own half, so a
  // later Unsolve could only ever hand back one of the two.
  const result = await prisma.$transaction(async (tx) => {
    if (mode === "unsolve") {
      const claimed = await tx.action.updateMany({
        where: { id: actionId ?? "", moveReviewStatus: "SOLVED" },
        data: { moveReviewStatus: "OPEN" },
      });
      if (!claimed.count) throw new UserError("That Move isn't solved.");

      // Re-read inside the transaction rather than trusting the row loaded
      // before it: the snapshot is what the revert reverses, so it has to be
      // the snapshot as it stands now.
      const fresh = await tx.action.findUnique({ where: { id: actionId ?? "" } });
      // Reverses exactly what the snapshot says was pushed — never recomputed
      // from the row's current numbers, which a GM may have just edited.
      const given = await revertMoveEffects(tx, fresh);
      await tx.action.update({
        where: { id: actionId },
        data: {
          appliedEffects: Prisma.DbNull,
          reviewedAt: null,
          reviewedByDiscordUserId: null,
          lockedByDiscordUserId: null,
          lockExpiresAt: null,
        },
      });
      return { status: "OPEN", note: describeMoveEffects(given) ? `Handed back ${describeMoveEffects(given)}.` : "Reopened." };
    }

    const data = normalizeEdits(action, edits, action.character.tags);

    if (mode === "save") {
      // Saving a SOLVED row back to Open would strand its appliedEffects: the
      // resources stay pushed with no snapshot left to hand them back from.
      // Reopening is the operation that means this, and it reverses properly.
      const claimed = await tx.action.updateMany({
        where: { id: actionId ?? "", moveReviewStatus: { not: "SOLVED" } },
        data: { moveReviewStatus: "OPEN" },
      });
      if (!claimed.count) throw new UserError("That Move is solved — reopen it before editing.");

      await tx.action.update({
        where: { id: actionId },
        data: { ...data, lockedByDiscordUserId: null, lockExpiresAt: null },
      });
      return { status: "OPEN", note: "Saved." };
    }

    // Solve. The claim goes first, so a row that is already SOLVED never
    // reaches applyMoveEffects and cannot pay out twice.
    const claimed = await tx.action.updateMany({
      where: { id: actionId ?? "", moveReviewStatus: { not: "SOLVED" } },
      data: { moveReviewStatus: "SOLVED" },
    });
    if (!claimed.count) throw new UserError("Another GM already solved that Move.");

    // Push against the EDITED row, so a GM who changed the delta pushes their
    // number rather than the player's.
    const edited = await tx.action.update({ where: { id: actionId }, data });
    const applied = await applyMoveEffects(tx, edited);
    await tx.action.update({
      where: { id: actionId },
      data: {
        appliedEffects: applied,
        reviewedAt: new Date(),
        reviewedByDiscordUserId: session.discordUserId,
        lockedByDiscordUserId: null,
        lockExpiresAt: null,
      },
    });
    return { status: "SOLVED", note: describeMoveEffects(applied) || "Solved." };
  });

  // A failed DM is reported, not swallowed. `.catch(() => null)` here is what
  // let a GM watch a Move go green while the player was never told — most
  // often because the result ran past Discord's 2000 characters, which nothing
  // was checking. The Move itself is already committed, so this can't undo
  // anything; it just has to say so.
  let deliveryFailed = false;
  if (mode === "solve" && notifyPlayer && edits.resultMessage?.toString().trim()) {
    try {
      await sendDm(action.character.discordUserId, edits.resultMessage.toString().trim());
    } catch (err) {
      console.error(`Failed to DM the Move result to ${action.character.discordUserId}:`, err);
      deliveryFailed = true;
    }
  }

  await prisma.auditLog.create({
    data: {
      actorDiscordUserId: session.discordUserId,
      actionType: `move_${mode}`,
      targetCharacterId: action.characterId,
      details: { actionId, note: result.note },
    },
  });

  revalidatePath("/gm/turns");
  revalidatePath("/character");
  return { ...result, deliveryFailed };
}

// Reject deletes the row outright. That's the point: the turn-economy checks
// in the bot's Move modal and location.js#performMove both look for
// ANY Action on the open turn, so only a deletion actually frees the player to
// act again. The description and reason are copied into the audit row first so
// nothing is lost with it, and the player is told — a freed turn they don't
// know about is a wasted day.
async function rejectMoveImpl({ actionId, reason: rawReason }) {
  const session = await requireGm();
  const reason = requireReason(rawReason);

  const action = await prisma.action.findUnique({ where: { id: actionId }, include: { character: true } });
  if (!action) throw new UserError("Move not found.");
  if (lockIsLive(action) && action.lockedByDiscordUserId !== session.discordUserId) {
    throw new UserError(`${await lockHolderName(action.lockedByDiscordUserId)} is adjudicating this Move.`);
  }

  await prisma.$transaction(async (tx) => {
    // A rejected Routine already pushed its resources; take them back, or the
    // player keeps the ⬢ from a Move that no longer exists. Shared with the
    // Dev Panel's Restore-turn button (web/lib/moveEconomy.js).
    await deleteActionRestoringTurn(tx, action);
    await tx.auditLog.create({
      data: {
        actorDiscordUserId: session.discordUserId,
        actionType: "move_rejected",
        targetCharacterId: action.characterId,
        reason,
        details: {
          actionId,
          description: action.description,
          moveKind: action.moveKind,
          appliedEffects: action.appliedEffects ?? null,
        },
      },
    });
  });

  // Same reasoning as the solve path: a freed turn the player doesn't know
  // about is a wasted day, so a failed DM has to reach the GM.
  let deliveryFailed = false;
  try {
    await sendDm(
      action.character.discordUserId,
      `Your Move was returned to you — you can act again this turn.\n${reason}`,
    );
  } catch (err) {
    console.error(`Failed to DM the rejection to ${action.character.discordUserId}:`, err);
    deliveryFailed = true;
  }

  revalidatePath("/gm/turns");
  revalidatePath("/character");
  return { description: action.description, deliveryFailed };
}

export async function claimMoveLock(input) {
  return guarded(() => claimMoveLockImpl(input));
}

export async function refreshMoveLock(input) {
  return guarded(() => refreshMoveLockImpl(input));
}

export async function releaseMoveLock(input) {
  return guarded(() => releaseMoveLockImpl(input));
}

export async function resolveMove(input) {
  return guarded(() => resolveMoveImpl(input));
}

export async function rejectMove(input) {
  return guarded(() => rejectMoveImpl(input));
}
