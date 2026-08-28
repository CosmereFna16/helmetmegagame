"use server";

import { revalidatePath } from "next/cache";
import { TURNS_PATH } from "@/lib/routes";
import { prisma, rollDie, Prisma } from "@lifeweb/db";
import { gambitModifierTotal } from "@lifeweb/db/lib/gambitModifier";
import { TagOpError, validateTagOps } from "@lifeweb/db/lib/tagOps";
import { postMessage } from "@lifeweb/db/lib/discordRest";
import { getGmSession, killCharacter, listGuildMembers, sendDm } from "@/lib/discordGuild";
import { REQUEST_EFFECTS } from "@/lib/requestEffects";
import { requireReason } from "@/lib/requests";
import { UserError, guarded } from "@/lib/actionResult";
import { deleteActionRestoringTurn, MOVE_LOCK_TTL_MS, lockIsLive } from "@/lib/moveEconomy";
import { GM_MESSAGE_MAX_LENGTH } from "@/lib/constants";
import { TAG_CHIP_FIELDS } from "@/lib/referenceData";

// The server half of the adjudication workspace. Everything here follows the
// staged-arbitration rule: nothing a GM does on the desk touches a player's
// sheet or DMs — Solve is bookkeeping, and the staged rows this file writes
// are applied and delivered by the turn-end push (db/lib/stagedPush.js).
// The exceptions are the ones that must act now by nature: Reject (unlock),
// the FEED_PERSON kill, and Request review, which has always been apply-first.

async function requireGm() {
  const { session, isGm: gm } = await getGmSession();
  if (!session?.discordUserId) throw new UserError("Not authenticated.");
  if (!gm) throw new UserError("Not authorized.");
  return session;
}

// A staged row is fat-finger-guarded, not player-clamped: GM-staged payouts
// are the sanctioned way past the player-side ±20, so this bound only exists
// to catch a slipped keystroke.
const MAX_STAGED_RESOURCES = 500;

// Same fat-finger guard, over tag points instead of ⬢. Negatives are a
// sanctioned use (see web/lib/characterWrite.js) so the cap is symmetric.
const MAX_STAGED_TAG_POINTS = 100;

async function requireOpenTurn() {
  const openTurn = await prisma.turn.findFirst({ where: { status: "OPEN" } });
  if (!openTurn) throw new UserError("No turn is open.");
  return openTurn;
}

// The turn-boundary race, handled honestly rather than locked away: a row
// created in the seconds around the cron can land on a turn the push already
// swept. Re-read after the insert and retarget to the new open turn; anything
// that still slips through is caught by the tray's missed-push banner.
async function retargetIfTurnClosed(model, ids, turnId) {
  const still = await prisma.turn.findFirst({ where: { id: turnId, status: "OPEN" } });
  if (still) return;
  const fresh = await prisma.turn.findFirst({ where: { status: "OPEN" } });
  if (!fresh) return;
  await model.updateMany({ where: { id: { in: ids } }, data: { turnId: fresh.id } });
}

// ---------------------------------------------------------------------------
// Staged messages
// ---------------------------------------------------------------------------

function normalizeMessageContent(raw) {
  const content = raw?.toString().trim() ?? "";
  if (!content) throw new UserError("Write the message first.");
  if (content.length > GM_MESSAGE_MAX_LENGTH) {
    throw new UserError(`Messages cap at ${GM_MESSAGE_MAX_LENGTH} characters.`);
  }
  return content;
}

async function normalizeRecipients(recipientCharacterIds) {
  const ids = [...new Set((recipientCharacterIds ?? []).filter(Boolean))];
  if (!ids.length) throw new UserError("Pick at least one recipient.");
  const found = await prisma.character.findMany({ where: { id: { in: ids } }, select: { id: true } });
  if (found.length !== ids.length) throw new UserError("One of those characters no longer exists.");
  return ids;
}

async function createStagedMessageImpl({ kind, content, recipientCharacterIds, moveId, cavingRollId, zoneId }) {
  const session = await requireGm();
  if (!["PRIVATE", "PUBLIC"].includes(kind)) throw new UserError("Unknown message kind.");
  const text = normalizeMessageContent(content);
  const openTurn = await requireOpenTurn();

  const recipients = kind === "PRIVATE" ? await normalizeRecipients(recipientCharacterIds) : [];

  const row = await prisma.stagedMessage.create({
    data: {
      turnId: openTurn.id,
      moveId: moveId || null,
      // Same SetNull-detach reasoning as moveId — a GM staging narration
      // against a Caving Die roll of 1 (see docs/systemdocs/CAVING.md).
      cavingRollId: cavingRollId || null,
      kind,
      content: text,
      zoneId: (kind === "PUBLIC" && zoneId) || null,
      createdByDiscordUserId: session.discordUserId,
      recipients: { create: recipients.map((characterId) => ({ characterId })) },
    },
  });
  await retargetIfTurnClosed(prisma.stagedMessage, [row.id], openTurn.id);

  await prisma.auditLog.create({
    data: {
      actorDiscordUserId: session.discordUserId,
      actionType: "staged_message_created",
      details: { stagedMessageId: row.id, kind, moveId: moveId || null, recipients: recipients.length },
    },
  });

  revalidatePath(TURNS_PATH, "page");
  return { id: row.id };
}

async function updateStagedMessageImpl({ stagedMessageId, content, recipientCharacterIds, zoneId }) {
  const session = await requireGm();
  const existing = await prisma.stagedMessage.findUnique({ where: { id: stagedMessageId ?? "" } });
  if (!existing) throw new UserError("That staged message is gone.");
  if (existing.sentAt) throw new UserError("That message already went out — it can't be edited.");

  const text = normalizeMessageContent(content);
  const recipients = existing.kind === "PRIVATE" ? await normalizeRecipients(recipientCharacterIds) : null;

  await prisma.$transaction(async (tx) => {
    // Conditional on sentAt so an edit racing the push loses cleanly rather
    // than rewriting a message that was already delivered as something else.
    const claimed = await tx.stagedMessage.updateMany({
      where: { id: existing.id, sentAt: null },
      data: {
        content: text,
        ...(existing.kind === "PUBLIC" ? { zoneId: zoneId || null } : {}),
      },
    });
    if (!claimed.count) throw new UserError("That message just went out — it can't be edited.");
    if (recipients) {
      await tx.stagedMessageRecipient.deleteMany({ where: { stagedMessageId: existing.id } });
      await tx.stagedMessageRecipient.createMany({
        data: recipients.map((characterId) => ({ stagedMessageId: existing.id, characterId })),
      });
    }
  });

  await prisma.auditLog.create({
    data: {
      actorDiscordUserId: session.discordUserId,
      actionType: "staged_message_updated",
      details: { stagedMessageId: existing.id },
    },
  });

  revalidatePath(TURNS_PATH, "page");
  return {};
}

async function deleteStagedMessageImpl({ stagedMessageId }) {
  const session = await requireGm();
  const existing = await prisma.stagedMessage.findUnique({ where: { id: stagedMessageId ?? "" } });
  if (!existing) return {};
  if (existing.sentAt) throw new UserError("That message already went out.");

  await prisma.stagedMessage.delete({ where: { id: existing.id } });
  await prisma.auditLog.create({
    data: {
      actorDiscordUserId: session.discordUserId,
      actionType: "staged_message_deleted",
      details: { stagedMessageId: existing.id, kind: existing.kind, content: existing.content.slice(0, 200) },
    },
  });

  revalidatePath(TURNS_PATH, "page");
  return {};
}

// Retries a sent-but-partially-failed staged message. PRIVATE re-sends only
// the recipients db/lib/stagedPush.js recorded as failed (same shape it
// wrote: [{ characterId, name, error }]); PUBLIC re-posts to the summary
// channel (its failure record is [{ error }], no per-recipient list). Clears
// deliveryFailures on a clean resend, matching the push's own "no failures"
// convention (Prisma.DbNull, not JS null — see db/index.js's runSideEffects).
async function resendStagedMessageImpl({ stagedMessageId }) {
  const session = await requireGm();
  const existing = await prisma.stagedMessage.findUnique({
    where: { id: stagedMessageId ?? "" },
    include: { recipients: { include: { character: { select: { id: true, name: true, discordUserId: true } } } } },
  });
  if (!existing) throw new UserError("That staged message is gone.");
  if (!existing.sentAt) throw new UserError("That message hasn't gone out yet.");
  const priorFailures = Array.isArray(existing.deliveryFailures) ? existing.deliveryFailures : [];
  if (!priorFailures.length) throw new UserError("Nothing failed on that message.");

  let stillFailing = [];
  let resent = 0;

  if (existing.kind === "PRIVATE") {
    const failedIds = new Set(priorFailures.map((f) => f.characterId).filter(Boolean));
    const targets = existing.recipients
      .map((r) => r.character)
      .filter((c) => failedIds.has(c.id));
    for (const target of targets) {
      try {
        await sendDm(target.discordUserId, existing.content, {
          authorDiscordUserId: existing.createdByDiscordUserId,
          source: "staged_push",
        });
        resent += 1;
      } catch (err) {
        stillFailing.push({ characterId: target.id, name: target.name, error: String(err?.message ?? err) });
      }
    }
  } else {
    const config = await prisma.gameConfig.findUnique({ where: { id: 1 }, select: { turnSummaryChannelId: true } });
    if (!config?.turnSummaryChannelId) throw new UserError("No summary channel is configured.");
    try {
      await postMessage(config.turnSummaryChannelId, existing.content);
      resent += 1;
    } catch (err) {
      stillFailing = [{ error: String(err?.message ?? err) }];
    }
  }

  await prisma.stagedMessage.update({
    where: { id: existing.id },
    data: { deliveryFailures: stillFailing.length ? stillFailing : Prisma.DbNull },
  });

  await prisma.auditLog.create({
    data: {
      actorDiscordUserId: session.discordUserId,
      actionType: "staged_message_resent",
      details: { stagedMessageId: existing.id, resent, stillFailing: stillFailing.length },
    },
  });

  revalidatePath(TURNS_PATH, "page");
  return { resent, stillFailing };
}

// ---------------------------------------------------------------------------
// Staged effects
// ---------------------------------------------------------------------------

// The composer stages presence ops only (add/remove). Patch and equip belong
// to the Dev Panel's full editor — a turn-end adjudication is about
// inflicting and removing, and keeping the shape small keeps validation and
// the push honest about what can appear in a payload.
function normalizeStagedOps(tagOps) {
  const ops = Array.isArray(tagOps) ? tagOps : [];
  return ops.map((op) => {
    if (!op?.tagId || !["add", "remove"].includes(op.op)) {
      throw new UserError("Only add and remove can be staged here.");
    }
    const quantity = op.quantity == null ? null : Number.parseInt(op.quantity, 10);
    if (quantity != null && (!Number.isInteger(quantity) || quantity < 1)) {
      throw new UserError("Quantities must be whole numbers of at least 1.");
    }
    return { tagId: op.tagId, op: op.op, ...(quantity != null ? { quantity } : {}) };
  });
}

function normalizeStagedResources(raw) {
  if (raw === "" || raw == null) return 0;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) throw new UserError("Resources must be a number.");
  if (Math.abs(n) > MAX_STAGED_RESOURCES) {
    throw new UserError(`That's over the ±${MAX_STAGED_RESOURCES} ⬢ sanity cap — stage it in parts if you mean it.`);
  }
  return n;
}

function normalizeStagedTagPoints(raw) {
  if (raw === "" || raw == null) return 0;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) throw new UserError("Tag points must be a number.");
  if (Math.abs(n) > MAX_STAGED_TAG_POINTS) {
    throw new UserError(`That's over the ±${MAX_STAGED_TAG_POINTS} tag-point sanity cap.`);
  }
  return n;
}

// The composer's "Relocate to" select. Raw relocation, same semantics as the
// Dev Panel's zone edit and Bulk Move — no Action row, no Move cost, no
// adjacency check (deliberately not performTravel). Mirrors the zone check
// in web/lib/characterWrite.js: a presence zone only, never the Caves group
// row nobody actually stands in.
async function normalizeStagedZone(raw) {
  const zoneId = raw?.toString().trim() || null;
  if (!zoneId) return null;
  const zone = await prisma.zone.findUnique({ where: { id: zoneId } });
  if (!zone) throw new UserError("That zone no longer exists.");
  if (zone.kind === "CAVE_GROUP") throw new UserError("That isn't a place a character can stand.");
  return zoneId;
}

async function createStagedEffectsImpl({ targetCharacterIds, moveId, cavingRollId, resources, tagPoints, tagOps, zoneId }) {
  const session = await requireGm();
  const targets = [...new Set((targetCharacterIds ?? []).filter(Boolean))];
  if (!targets.length) throw new UserError("Pick at least one target.");

  const delta = normalizeStagedResources(resources);
  const points = normalizeStagedTagPoints(tagPoints);
  const ops = normalizeStagedOps(tagOps);
  // One zone for the whole batch — the composer only offers one select for
  // however many targets are picked.
  const zone = await normalizeStagedZone(zoneId);
  if (!delta && !points && !ops.length && !zone) throw new UserError("Stage a resource, tag-point, tag change, or zone change.");

  // Validated NOW against the catalog, with the same engine the push runs, so
  // the composer and the turn can't disagree. Presence ops don't read the
  // holder, so one validation covers every target.
  if (ops.length) {
    const tags = await prisma.tag.findMany({ where: { id: { in: ops.map((o) => o.tagId) } } });
    try {
      validateTagOps(ops, new Map(tags.map((t) => [t.id, t])), new Set());
    } catch (err) {
      if (err instanceof TagOpError) throw new UserError(err.message);
      throw err;
    }
  }

  const found = await prisma.character.findMany({ where: { id: { in: targets } }, select: { id: true } });
  if (found.length !== targets.length) throw new UserError("One of those characters no longer exists.");

  const openTurn = await requireOpenTurn();
  const batchId = targets.length > 1 ? crypto.randomUUID() : null;
  const payload = {
    ...(delta ? { resources: delta } : {}),
    ...(points ? { tagPoints: points } : {}),
    ...(ops.length ? { tagOps: ops } : {}),
    ...(zone ? { zoneId: zone } : {}),
  };

  const created = await prisma.$transaction(
    targets.map((targetCharacterId) =>
      prisma.stagedEffect.create({
        data: {
          turnId: openTurn.id,
          moveId: moveId || null,
          cavingRollId: cavingRollId || null,
          targetCharacterId,
          createdByDiscordUserId: session.discordUserId,
          batchId,
          payload,
        },
        select: { id: true },
      }),
    ),
  );
  await retargetIfTurnClosed(prisma.stagedEffect, created.map((r) => r.id), openTurn.id);

  await prisma.auditLog.create({
    data: {
      actorDiscordUserId: session.discordUserId,
      actionType: "staged_effects_created",
      details: { batchId, targets: targets.length, moveId: moveId || null, payload },
    },
  });

  revalidatePath(TURNS_PATH, "page");
  return { count: created.length, batchId };
}

async function updateStagedEffectImpl({ stagedEffectId, resources, tagPoints, tagOps, zoneId }) {
  const session = await requireGm();
  const existing = await prisma.stagedEffect.findUnique({ where: { id: stagedEffectId ?? "" } });
  if (!existing) throw new UserError("That staged effect is gone.");
  if (existing.appliedAt) throw new UserError("That effect already applied — it can't be edited.");

  const delta = normalizeStagedResources(resources);
  const points = normalizeStagedTagPoints(tagPoints);
  const ops = normalizeStagedOps(tagOps);
  const zone = await normalizeStagedZone(zoneId);
  if (!delta && !points && !ops.length && !zone) throw new UserError("Stage a resource, tag-point, tag change, or zone change.");
  if (ops.length) {
    const tags = await prisma.tag.findMany({ where: { id: { in: ops.map((o) => o.tagId) } } });
    try {
      validateTagOps(ops, new Map(tags.map((t) => [t.id, t])), new Set());
    } catch (err) {
      if (err instanceof TagOpError) throw new UserError(err.message);
      throw err;
    }
  }

  // Editing detaches the row from its batch: the batch was one identical
  // payload over N targets, and this row no longer matches its siblings.
  const claimed = await prisma.stagedEffect.updateMany({
    where: { id: existing.id, appliedAt: null },
    data: {
      payload: {
        ...(delta ? { resources: delta } : {}),
        ...(points ? { tagPoints: points } : {}),
        ...(ops.length ? { tagOps: ops } : {}),
        ...(zone ? { zoneId: zone } : {}),
      },
      batchId: null,
    },
  });
  if (!claimed.count) throw new UserError("That effect just applied — it can't be edited.");

  await prisma.auditLog.create({
    data: {
      actorDiscordUserId: session.discordUserId,
      actionType: "staged_effect_updated",
      details: { stagedEffectId: existing.id },
    },
  });

  revalidatePath(TURNS_PATH, "page");
  return {};
}

async function deleteStagedEffectImpl({ stagedEffectId, batchId }) {
  const session = await requireGm();

  if (batchId) {
    const { count } = await prisma.stagedEffect.deleteMany({ where: { batchId, appliedAt: null } });
    await prisma.auditLog.create({
      data: {
        actorDiscordUserId: session.discordUserId,
        actionType: "staged_effects_deleted",
        details: { batchId, count },
      },
    });
    revalidatePath(TURNS_PATH, "page");
    return { count };
  }

  const existing = await prisma.stagedEffect.findUnique({ where: { id: stagedEffectId ?? "" } });
  if (!existing) return { count: 0 };
  if (existing.appliedAt) throw new UserError("That effect already applied.");
  await prisma.stagedEffect.delete({ where: { id: existing.id } });
  await prisma.auditLog.create({
    data: {
      actorDiscordUserId: session.discordUserId,
      actionType: "staged_effects_deleted",
      details: { stagedEffectId: existing.id, count: 1 },
    },
  });
  revalidatePath(TURNS_PATH, "page");
  return { count: 1 };
}

// The missed-push banner's verb: staged rows a resolved turn's push never got
// to (a crash, a validation skip that was then edited) move onto the open
// turn so the next push carries them.
async function retargetMissedStagingImpl({ effectIds = [], messageIds = [] }) {
  const session = await requireGm();
  const openTurn = await requireOpenTurn();

  const [effects, messages] = await Promise.all([
    effectIds.length
      ? prisma.stagedEffect.updateMany({
          where: { id: { in: effectIds }, appliedAt: null },
          data: { turnId: openTurn.id },
        })
      : { count: 0 },
    messageIds.length
      ? prisma.stagedMessage.updateMany({
          where: { id: { in: messageIds }, sentAt: null },
          data: { turnId: openTurn.id, deliveryFailures: null },
        })
      : { count: 0 },
  ]);

  await prisma.auditLog.create({
    data: {
      actorDiscordUserId: session.discordUserId,
      actionType: "staging_retargeted",
      details: { toTurnNumber: openTurn.number, effects: effects.count, messages: messages.count },
    },
  });

  revalidatePath(TURNS_PATH, "page");
  return { effects: effects.count, messages: messages.count };
}

// ---------------------------------------------------------------------------
// Moves — Solve is bookkeeping now
// ---------------------------------------------------------------------------

async function lockHolderName(discordUserId) {
  if (!discordUserId) return "Another GM";
  const members = await listGuildMembers().catch(() => []);
  return members.find((m) => m.id === discordUserId)?.username ?? "Another GM";
}

// See the old gm/turns/actions.js for the history of this claim being one
// conditional write. The three OR arms are the whole rule: nobody holds it, I
// already hold it, or whoever held it let the 90s TTL lapse.
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
    const action = await prisma.action.findUnique({ where: { id: actionId ?? "" } });
    if (!action) throw new UserError("Move not found.");
    const holder = await lockHolderName(action.lockedByDiscordUserId);
    throw new UserError(`${holder} is adjudicating this Move.`);
  }

  return { ttlMs: MOVE_LOCK_TTL_MS };
}

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
  return {};
}

// Kind is the interesting edit: a Gambit always carries a fresh roll and a
// Routine never carries one, so switching either way rewrites the dice rather
// than leaving a stale number behind. The resource-delta editor is gone —
// under staged arbitration a GM who disagrees with the declared numbers
// stages a counter-effect instead of rewriting the player's.
function normalizeEdits(action, edits, characterTags, hungerStreak) {
  const data = {};

  const kind = edits.moveKind === "GAMBIT" || edits.moveKind === "ROUTINE" ? edits.moveKind : action.moveKind;
  if (kind !== action.moveKind) {
    data.moveKind = kind;
    if (kind === "ROUTINE") {
      data.diceRoll = null;
      data.diceModifier = null;
    } else {
      // Rolled from the character's CURRENT tags — a status that lapsed between
      // submission and adjudication shouldn't haunt a roll made today. Same
      // for hungerStreak: it's read fresh, not off whatever was true when the
      // player submitted.
      data.diceRoll = rollDie();
      data.diceModifier = gambitModifierTotal(characterTags, { hungerStreak });
    }
  }

  data.resultMessage = edits.resultMessage?.toString().trim() || null;
  return data;
}

// mode "save"    -> keep the edits, leave the Move open
// mode "solve"   -> keep the edits, mark SOLVED (staging complete — nothing
//                   applies until the push)
// mode "unsolve" -> back to OPEN (nothing to revert pre-push)
async function resolveMoveImpl({ actionId, mode, edits = {} }) {
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

  // The conditional writes below are the same discipline the old panel had —
  // the check and the transition are one statement — even though a double
  // Solve no longer pays anyone twice. It still stops two GMs from silently
  // overwriting each other's verdicts.
  const result = await prisma.$transaction(async (tx) => {
    if (mode === "unsolve") {
      const claimed = await tx.action.updateMany({
        where: { id: actionId ?? "", moveReviewStatus: "SOLVED" },
        data: {
          moveReviewStatus: "OPEN",
          reviewedAt: null,
          reviewedByDiscordUserId: null,
          lockedByDiscordUserId: null,
          lockExpiresAt: null,
        },
      });
      if (!claimed.count) throw new UserError("That Move isn't solved.");
      return { status: "OPEN", note: "Reopened." };
    }

    const data = normalizeEdits(action, edits, action.character.tags, action.character.hungerStreak);

    if (mode === "save") {
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

    // Solve — staging complete. Nothing applies here; the declared numbers
    // and every staged row land together at the push.
    const claimed = await tx.action.updateMany({
      where: { id: actionId ?? "", moveReviewStatus: { not: "SOLVED" } },
      data: { moveReviewStatus: "SOLVED" },
    });
    if (!claimed.count) throw new UserError("Another GM already solved that Move.");

    await tx.action.update({
      where: { id: actionId },
      data: {
        ...data,
        reviewedAt: new Date(),
        reviewedByDiscordUserId: session.discordUserId,
        lockedByDiscordUserId: null,
        lockExpiresAt: null,
      },
    });
    return { status: "SOLVED", note: "Staged for the push." };
  });

  await prisma.auditLog.create({
    data: {
      actorDiscordUserId: session.discordUserId,
      actionType: `move_${mode}`,
      targetCharacterId: action.characterId,
      details: { actionId, note: result.note },
    },
  });

  revalidatePath(TURNS_PATH, "page");
  return result;
}

// The Caving lens' one verdict: "Mark resolved" on a TROUBLE roll, once the
// GM has narrated it and staged whatever effects the encounter needs. Unlike
// resolveMoveImpl there is no "unsolve" — a resolved Caving roll can simply
// be reopened by clearing gmNotes' worth from the desk if a GM changes their
// mind, so this stays a one-way stamp rather than a state machine. QUIET and
// FIND rows are already resolvedAt at creation and never reach this action
// from the UI (the desk only offers the button on an unresolved row), but it
// is harmless — and idempotent — if one ever does.
async function resolveCavingRollImpl({ cavingRollId, gmNotes: rawNotes }) {
  const session = await requireGm();
  const roll = await prisma.cavingRoll.findUnique({ where: { id: cavingRollId ?? "" } });
  if (!roll) throw new UserError("Caving roll not found.");

  const gmNotes = rawNotes?.toString().trim() || null;
  await prisma.cavingRoll.update({
    where: { id: roll.id },
    data: {
      resolvedAt: roll.resolvedAt ?? new Date(),
      resolvedByDiscordUserId: session.discordUserId,
      gmNotes,
    },
  });

  await prisma.auditLog.create({
    data: {
      actorDiscordUserId: session.discordUserId,
      actionType: "caving_roll_resolved",
      targetCharacterId: roll.characterId,
      details: { cavingRollId: roll.id, die: roll.die, kind: roll.kind },
    },
  });

  revalidatePath(TURNS_PATH, "page");
  return { status: "RESOLVED" };
}

// "Unlock" on the desk. Deletes the Action outright — the turn-economy checks
// all look for ANY Action on the open turn, so only a deletion actually frees
// the player to act again. Pre-push there is nothing to claw back
// (appliedEffects is null until the push claims it); staged rows linked to
// the Move detach via SetNull and surface in the tray as unattached.
async function rejectMoveImpl({ actionId, reason: rawReason }) {
  const session = await requireGm();
  const reason = requireReason(rawReason);

  const action = await prisma.action.findUnique({ where: { id: actionId }, include: { character: true } });
  if (!action) throw new UserError("Move not found.");
  if (lockIsLive(action) && action.lockedByDiscordUserId !== session.discordUserId) {
    throw new UserError(`${await lockHolderName(action.lockedByDiscordUserId)} is adjudicating this Move.`);
  }

  await prisma.$transaction(async (tx) => {
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

  // The one DM the desk sends directly, because it must arrive NOW: a freed
  // turn the player doesn't know about is a wasted day.
  let deliveryFailed = false;
  try {
    await sendDm(
      action.character.discordUserId,
      `Your Move was unlocked and returned to you — you can act again this turn.\n${reason}`,
      { authorDiscordUserId: session.discordUserId, source: "move_unlock" },
    );
  } catch (err) {
    console.error(`Failed to DM the unlock to ${action.character.discordUserId}:`, err);
    deliveryFailed = true;
  }

  revalidatePath(TURNS_PATH, "page");
  revalidatePath("/character");
  return { description: action.description, deliveryFailed };
}

// ---------------------------------------------------------------------------
// Requests — semantics unchanged from the old tab (apply-first, edit/undo)
// ---------------------------------------------------------------------------

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
    let changed = false;

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
        changed = Boolean(out.changed);
      } else {
        note = "Marked reviewed.";
      }
      // gmNotes alone is not an edit — a clean Confirm keeps the status the
      // player earned (PASSED, or a prior real EDITED) and just stamps
      // reviewedAt/reviewedByDiscordUserId below.
      status = changed ? "EDITED" : request.status;
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
        actionType: mode === "undo" ? "request_undone" : changed ? "request_edited" : "request_reviewed",
        targetCharacterId: request.characterId,
        reason: request.reason,
        details: { requestId, type: request.type, note },
      },
    });

    return { status: updated.status, note, changed };
  });

  revalidatePath(TURNS_PATH, "page");
  revalidatePath("/gm/audit");
  revalidatePath("/character");
  revalidatePath("/faction");
  return result;
}

// A Feed Person request never kills anyone on its own — this is the GM
// closing that loop, running the same death path as the character editor.
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

  revalidatePath(TURNS_PATH, "page");
  revalidatePath("/gm/players", "layout");
  revalidatePath("/gm/audit");
  revalidatePath("/lifeweb");
  return { targetName: target.name };
}

// ---------------------------------------------------------------------------
// Inspector fetchers — read-only DTOs for the right-hand column
// ---------------------------------------------------------------------------

async function getCharacterInspectorImpl({ characterId }) {
  await requireGm();
  const character = await prisma.character.findUnique({
    where: { id: characterId ?? "" },
    include: {
      faction: { select: { id: true, name: true } },
      zone: { select: { name: true } },
      tags: {
        select: { tagId: true, quantity: true, expiresTurn: true, equipped: true, tag: { select: TAG_CHIP_FIELDS } },
      },
    },
  });
  if (!character) throw new UserError("Character not found.");

  const openTurn = await prisma.turn.findFirst({ where: { status: "OPEN" }, select: { id: true, number: true } });
  const acted = openTurn
    ? Boolean(await prisma.action.findFirst({ where: { characterId: character.id, turnId: openTurn.id }, select: { id: true } }))
    : false;

  return {
    id: character.id,
    name: character.name,
    status: character.status,
    discordUserId: character.discordUserId,
    roleTitle: character.roleTitle ?? null,
    factionId: character.faction?.id ?? null,
    factionName: character.faction?.name ?? null,
    isLeader: character.isLeader,
    // Presence zone only — same key name and same reasoning as the queue
    // page's moves DTO.
    locationLabel: character.zone?.name || "Unassigned",
    resources: character.resources,
    tagPoints: character.tagPoints,
    gambitModifier: gambitModifierTotal(character.tags, { hungerStreak: character.hungerStreak }),
    acted,
    currentTurnNumber: openTurn?.number ?? null,
    tags: character.tags.map((ct) => ({
      tagId: ct.tagId,
      quantity: ct.quantity,
      expiresTurn: ct.expiresTurn,
      equipped: ct.equipped,
      tag: ct.tag,
    })),
  };
}

const ARCHIVE_SLICE = 30;

async function getArchiveSliceImpl({ characterId }) {
  await requireGm();
  const rows = await prisma.archiveEntry.findMany({
    where: { characterId: characterId ?? "" },
    orderBy: [{ sentAt: "desc" }, { id: "desc" }],
    take: ARCHIVE_SLICE,
  });
  // Newest-last, the way a transcript reads. Wrapped in an object because
  // guarded() spreads the payload — a bare array would come back as indices.
  return {
    entries: rows.reverse().map((e) => ({
      id: e.id,
      kind: e.kind,
      content: e.content,
      characterName: e.characterName,
      concealedAlias: e.concealedAlias,
      zoneName: e.zoneName,
      turnNumber: e.turnNumber,
      turnPhase: e.turnPhase,
      sentAt: e.sentAt.toISOString(),
    })),
  };
}

// getDmThreadImpl/sendInspectorDmImpl used to live here. The Inspector's DMs
// tab now uses web/app/(app)/gm/messages/actions.js#getDmThreadPage and
// #sendGmDm directly — the same functions the /gm/messages inbox uses — so
// there's one DM fetch/send path instead of two.

const CONTEXT_SLICE = 30;

// The scene around one archived line: ~30 messages before/after in the same
// Discord channel/thread, so a GM clicking an old transcript row doesn't have
// to reconstruct context from turn number and zone alone.
async function getArchiveContextImpl({ archiveEntryId }) {
  await requireGm();
  const anchor = await prisma.archiveEntry.findUnique({ where: { id: archiveEntryId ?? "" } });
  if (!anchor) throw new UserError("That transcript row is gone.");

  // Two ways to identify "the same channel": the snapshot column where it
  // exists, and the legacy zoneId/channelKind/threadName triple for rows
  // written before the backfill. Both prongs stay live because history is
  // mixed — a null in the legacy triple intentionally matches IS NULL. Rows
  // older than the zone rework carry a Location id in zoneId and "plain" as
  // their channelKind; they still group with each other, which is all this
  // needs.
  const identity = [];
  if (anchor.discordChannelId) identity.push({ discordChannelId: anchor.discordChannelId });
  if (anchor.zoneId != null || anchor.channelKind != null) {
    identity.push({ zoneId: anchor.zoneId, channelKind: anchor.channelKind, threadName: anchor.threadName });
  }
  if (!identity.length) throw new UserError("That row carries no channel identity.");

  const channelWhere = { kind: "MESSAGE", OR: identity };

  const [before, after] = await Promise.all([
    prisma.archiveEntry.findMany({
      where: {
        AND: [
          channelWhere,
          { OR: [{ sentAt: { lt: anchor.sentAt } }, { sentAt: anchor.sentAt, id: { lt: anchor.id } }] },
        ],
      },
      orderBy: [{ sentAt: "desc" }, { id: "desc" }],
      take: CONTEXT_SLICE,
    }),
    prisma.archiveEntry.findMany({
      where: {
        AND: [
          channelWhere,
          { OR: [{ sentAt: { gt: anchor.sentAt } }, { sentAt: anchor.sentAt, id: { gt: anchor.id } }] },
        ],
      },
      orderBy: [{ sentAt: "asc" }, { id: "asc" }],
      take: CONTEXT_SLICE,
    }),
  ]);

  // Server-only env — this is why the URL is built here, never client-side.
  const guildId = process.env.DISCORD_GUILD_ID || null;
  const channelLabel =
    [anchor.zoneName, anchor.threadName].filter(Boolean).join(" · ") || anchor.channelKind || "unknown channel";
  // Event rows and legacy thread rows can't link; Dawn-wiped messages make
  // old links dead anyway — the popup itself is the durable value.
  const jumpUrl =
    guildId && anchor.discordChannelId && anchor.discordMessageId
      ? `https://discord.com/channels/${guildId}/${anchor.discordChannelId}/${anchor.discordMessageId}`
      : null;

  const entries = [...before.reverse(), anchor, ...after].map((e) => ({
    id: e.id,
    content: e.content,
    characterName: e.characterName,
    concealedAlias: e.concealedAlias,
    turnNumber: e.turnNumber,
    sentAt: e.sentAt.toISOString(),
  }));

  return { anchorId: anchor.id, channelLabel, jumpUrl, entries };
}

// The composer's held-tags panel: lean rows for one character, keyed by tag,
// so a GM can stage a remove without re-typing the name into the catalog
// search.
async function getHeldTagsImpl({ characterId }) {
  await requireGm();
  const rows = await prisma.characterTag.findMany({
    where: { characterId: characterId ?? "" },
    select: { tagId: true, quantity: true, tag: { select: { name: true, stackable: true } } },
    orderBy: { tag: { name: "asc" } },
  });
  return { tags: rows.map((r) => ({ tagId: r.tagId, name: r.tag.name, quantity: r.quantity, stackable: r.tag.stackable })) };
}

// ---------------------------------------------------------------------------

export async function createStagedMessage(input) {
  return guarded(() => createStagedMessageImpl(input));
}
export async function updateStagedMessage(input) {
  return guarded(() => updateStagedMessageImpl(input));
}
export async function deleteStagedMessage(input) {
  return guarded(() => deleteStagedMessageImpl(input));
}
export async function resendStagedMessage(input) {
  return guarded(() => resendStagedMessageImpl(input));
}
export async function createStagedEffects(input) {
  return guarded(() => createStagedEffectsImpl(input));
}
export async function updateStagedEffect(input) {
  return guarded(() => updateStagedEffectImpl(input));
}
export async function deleteStagedEffect(input) {
  return guarded(() => deleteStagedEffectImpl(input));
}
export async function retargetMissedStaging(input) {
  return guarded(() => retargetMissedStagingImpl(input));
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
export async function resolveCavingRoll(input) {
  return guarded(() => resolveCavingRollImpl(input));
}
export async function resolveRequest(input) {
  return guarded(() => resolveRequestImpl(input));
}
export async function killRequestTarget(input) {
  return guarded(() => killRequestTargetImpl(input));
}
export async function getCharacterInspector(input) {
  return guarded(() => getCharacterInspectorImpl(input));
}
export async function getArchiveSlice(input) {
  return guarded(() => getArchiveSliceImpl(input));
}
export async function getHeldTags(input) {
  return guarded(() => getHeldTagsImpl(input));
}
export async function getArchiveContext(input) {
  return guarded(() => getArchiveContextImpl(input));
}
