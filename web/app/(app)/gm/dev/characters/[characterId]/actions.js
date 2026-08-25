"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { prisma, isDynastyHead, deleteCharacterRow } from "@lifeweb/db";
import { UserError, guarded } from "@/lib/actionResult";
import { isSuperadmin } from "@/lib/superadmin";
import {
  getGmSession,
  ensureCharacterRole,
  syncCharacterNickname,
  syncCharacterLocationAccess,
  syncCharacterNarrowcastAccess,
  revokeAllCharacterAccess,
  deleteCharacterRole,
  updateGuildNickname,
  removeCursedRole,
  killCharacter,
  sendDm,
} from "@/lib/discordGuild";
import { propagateDynastyLastName } from "@/lib/dynasty";
import { formatBareName } from "@/lib/characterName";
import {
  normalizeCoreEdits,
  diffCore,
  setLeaderInTx,
  validateTagOps,
  applyTagOpsInTx,
  planDiscordEffects,
} from "@/lib/characterWrite";
import { findOpenTurnAction, lockIsLive, deleteActionRestoringTurn } from "@/lib/moveEconomy";

// Everything here is gated on GM membership, not superadmin: this panel is
// reachable from every character-name link in the app and an in-game GM is
// meant to use it. The two irreversible ones (deleting a character) are
// stricter — see requireSuperadminSession.
//
// UserError rather than a bare throw, throughout. Next redacts a thrown Error
// out of a server action into React #441 in production, so a plain throw
// shows the GM an error code instead of a sentence (web/lib/actionResult.js).
async function requireGm() {
  const { session, isGm: gm } = await getGmSession();
  if (!session?.discordUserId || !gm) throw new UserError("Not authorized.");
  return session;
}

async function requireSuperadminSession() {
  const session = await requireGm();
  if (!isSuperadmin(session.discordUserId)) {
    throw new UserError("Only a superadmin can do that.");
  }
  return session;
}

function repaint(characterId) {
  revalidatePath(`/gm/dev/characters/${characterId}`);
  revalidatePath("/gm/players");
  revalidatePath("/character");
}

async function loadCharacter(characterId) {
  const character = await prisma.character.findUnique({
    where: { id: characterId },
    include: { role: true },
  });
  if (!character) throw new UserError("That character no longer exists.");
  return character;
}

async function audit(session, actionType, characterId, details, reason = null) {
  await prisma.auditLog.create({
    data: {
      actorDiscordUserId: session.discordUserId,
      actionType,
      targetCharacterId: characterId,
      reason,
      details,
    },
  });
}

// ───────────────────────────────────────────────────────────────────────────
// The one staged-apply action.
// ───────────────────────────────────────────────────────────────────────────

// Everything the GM edited in the panel, committed together: one transaction,
// one audit row, one repaint. Tag changes ride along in the same payload so
// "renamed them and gave them a sword" is a single reviewable event rather
// than two.
//
// `expectedUpdatedAt` is an optimistic lock. Two GMs on the same sheet is
// rare enough not to warrant the cooperative lock Moves use, but silently
// clobbering the other one's save is not acceptable either, so the loser is
// told to reload.
async function applyCharacterEditsImpl({ characterId, expectedUpdatedAt, core, tags, reason }) {
  const session = await requireGm();
  const existing = await loadCharacter(characterId);

  const [openTurn, config, held] = await Promise.all([
    prisma.turn.findFirst({ where: { status: "OPEN" }, select: { number: true } }),
    prisma.gameConfig.findUnique({ where: { id: 1 }, select: { equipSlots: true } }),
    prisma.characterTag.findMany({ where: { characterId }, select: { tagId: true } }),
  ]);

  const ops = Array.isArray(tags) ? tags : [];
  const tagRows = ops.length
    ? await prisma.tag.findMany({ where: { id: { in: ops.map((o) => o.tagId) } } })
    : [];
  const tagsById = new Map(tagRows.map((t) => [t.id, t]));
  const heldIds = new Set(held.map((h) => h.tagId));

  // Validate everything BEFORE opening the transaction, so a rejected payload
  // leaves nothing half-written and the GM sees the first real problem rather
  // than a rollback.
  validateTagOps(ops, tagsById, heldIds);
  const { data, role, leader } = await normalizeCoreEdits({ prisma, existing, core });
  const diff = diffCore(existing, data);

  if (!Object.keys(diff).length && !ops.length && leader === null) {
    return { name: existing.name, applied: {}, tags: [] };
  }

  let appliedTags = [];
  await prisma.$transaction(async (tx) => {
    // The same row lock character/equipActions.js#toggleEquip takes, for the
    // same reason: Postgres runs at READ COMMITTED, so without it an Apply
    // and a player's equip tap can both pass an equip-slot count that only
    // one of them should have.
    await tx.$queryRaw`SELECT id FROM "Character" WHERE id = ${characterId} FOR UPDATE`;

    const fresh = await tx.character.findUnique({
      where: { id: characterId },
      select: { updatedAt: true, status: true, factionId: true },
    });
    if (!fresh) throw new UserError("That character no longer exists.");
    if (expectedUpdatedAt && fresh.updatedAt.toISOString() !== expectedUpdatedAt) {
      throw new UserError(
        "Someone else edited this character while you had it open. Reload and reapply.",
      );
    }

    if (Object.keys(data).length) {
      await tx.character.update({ where: { id: characterId }, data });
    }

    // Keyed on the POST-edit faction: promoting someone who is also changing
    // faction must demote the NEW faction's leader, not the old one.
    if (leader !== null) {
      const factionId = "factionId" in data ? data.factionId : fresh.factionId;
      await setLeaderInTx(tx, { characterId, factionId, isLeader: leader });
    }

    if (ops.length) {
      appliedTags = await applyTagOpsInTx(tx, {
        characterId,
        ops,
        tagsById,
        openTurn,
        equipSlots: config?.equipSlots ?? 6,
      });
    }

    await tx.auditLog.create({
      data: {
        actorDiscordUserId: session.discordUserId,
        actionType: "gm_character_applied",
        targetCharacterId: characterId,
        reason: reason?.trim() || null,
        details: { core: diff, leader, tags: appliedTags },
      },
    });
  });

  // Discord, after the commit and outside the request. revokeAllCharacterAccess
  // and syncCharacterLocationAccess each walk every channel of a Location, and
  // propagateDynastyLastName is two REST calls per living family member — none
  // of that may hold the transaction, and none of it should hold the Apply
  // button either. Same posture as forceAdvanceTurn.
  const steps = planDiscordEffects({
    existing,
    diff,
    finalStatus: existing.status,
    role: role ?? existing.role,
    tagsTouched: ops.length > 0,
  });

  if (steps.length) {
    after(async () => {
      const updated = await prisma.character.findUnique({ where: { id: characterId } });
      if (!updated) return;
      // Strict order, sequential, each failure logged and stepped over: a
      // failed nickname sync must not stop the channel access from moving.
      for (const step of steps) {
        try {
          if (step === "role") await ensureCharacterRole(updated);
          if (step === "nickname") {
            await syncCharacterNickname(updated.discordUserId, formatBareName(updated));
          }
          if (step === "dynasty" && isDynastyHead((role ?? existing.role)?.slug)) {
            await propagateDynastyLastName(updated.lastName);
          }
          if (step === "location") {
            await syncCharacterLocationAccess(
              updated.discordUserId,
              diff.locationId?.from ?? null,
              updated.locationId,
            );
          }
          if (step === "narrowcast") await syncCharacterNarrowcastAccess(characterId);
        } catch (err) {
          console.error(`Dev Panel Discord step "${step}" failed for ${characterId}:`, err);
        }
      }
    });
  }

  repaint(characterId);
  if (diff.factionId || leader !== null || diff.isTreasurer) revalidatePath("/faction");

  return { name: data.name ?? existing.name, applied: diff, tags: appliedTags, discord: steps };
}

// ───────────────────────────────────────────────────────────────────────────
// Microactions. Each is a verb, fires on its own, and is idempotency-checked
// against live state rather than trusting the UI to have disabled its button.
// ───────────────────────────────────────────────────────────────────────────

// killCharacter is the canonical death path: revoke every channel overwrite,
// delete the personal Discord role and null the (unique) id, clear the
// nickname, grant Cursed, write the DEATH archive entry.
async function killCharacterNowImpl({ characterId, reason }) {
  const session = await requireGm();
  const character = await loadCharacter(characterId);
  if (character.status === "DEAD") throw new UserError(`${character.name} is already dead.`);

  const updated = await prisma.character.update({
    where: { id: characterId },
    data: { status: "DEAD" },
  });

  await audit(session, "gm_character_killed", characterId, { name: character.name }, reason?.trim() || null);

  after(() =>
    killCharacter(updated).catch((err) => console.error("killCharacter failed:", err)),
  );

  repaint(characterId);
  revalidatePath("/gm/turns");
  return { name: character.name };
}

// The inverse, which the old editor never had: setting a corpse back to ALIVE
// left it with no personal role, no channel access and the Cursed role still
// on the account.
//
// The old location is passed as null deliberately — killCharacter already
// stripped every overwrite, so this is a pure re-grant with nothing to move
// away from.
async function reviveCharacterImpl({ characterId }) {
  const session = await requireGm();
  const character = await loadCharacter(characterId);
  if (character.status === "ALIVE") throw new UserError(`${character.name} is already alive.`);

  const updated = await prisma.character.update({
    where: { id: characterId },
    data: { status: "ALIVE" },
  });

  await audit(session, "gm_character_revived", characterId, { name: character.name });

  after(async () => {
    try {
      await removeCursedRole(updated.discordUserId);
      await ensureCharacterRole(updated);
      await syncCharacterNickname(updated.discordUserId, formatBareName(updated));
      await syncCharacterLocationAccess(updated.discordUserId, null, updated.locationId);
      await syncCharacterNarrowcastAccess(characterId);
    } catch (err) {
      console.error("Revive Discord restore failed:", err);
    }
  });

  repaint(characterId);
  return { name: character.name };
}

// Giving the turn back means deleting the Action row — there is no
// turnsRemaining column, so nothing else frees the player (web/lib/moveEconomy.js).
async function restoreTurnImpl({ characterId, reason, notify = true }) {
  const session = await requireGm();
  const character = await loadCharacter(characterId);
  const { action } = await findOpenTurnAction(prisma, characterId);
  if (!action) throw new UserError(`${character.name} hasn't acted this turn.`);

  // Don't yank a Move out from under a GM who has it open in /gm/turns.
  if (lockIsLive(action) && action.lockedByDiscordUserId !== session.discordUserId) {
    throw new UserError("Another GM is adjudicating that Move right now.");
  }

  await prisma.$transaction(async (tx) => {
    await deleteActionRestoringTurn(tx, action);
    await tx.auditLog.create({
      data: {
        actorDiscordUserId: session.discordUserId,
        actionType: "gm_turn_restored",
        targetCharacterId: characterId,
        reason: reason?.trim() || null,
        details: {
          actionId: action.id,
          description: action.description,
          moveKind: action.moveKind,
          appliedEffects: action.appliedEffects ?? null,
        },
      },
    });
  });

  if (notify) {
    // A freed turn they don't know about is a wasted day.
    after(() =>
      sendDm(
        character.discordUserId,
        `Your Move was returned to you — you can act again this turn.${reason?.trim() ? `\n${reason.trim()}` : ""}`,
      ).catch(() => null),
    );
  }

  repaint(characterId);
  revalidatePath("/gm/turns");
  return { description: action.description };
}

// The mirror image: file a stub Move so the economy sees them as having acted.
// Shaped like db/lib/defaultMovePass.js's auto-filed Move — a PASSED Routine
// with an identifiable marker — and worth nothing, so Restore-turn has nothing
// to claw back.
async function spendTurnImpl({ characterId, description }) {
  const session = await requireGm();
  const character = await loadCharacter(characterId);
  const { openTurn, action } = await findOpenTurnAction(prisma, characterId);
  if (!openTurn) throw new UserError("No turn is open.");
  if (action) throw new UserError(`${character.name} has already acted this turn.`);

  const created = await prisma.action.create({
    data: {
      characterId,
      turnId: openTurn.id,
      zoneId: character.zoneId,
      description: description?.trim() || "Turn spent (GM).",
      moveKind: "ROUTINE",
      moveReviewStatus: "PASSED",
      resourceDelta: 0,
      gmNotes: "auto:gm_spent_turn",
      reviewedAt: new Date(),
      reviewedByDiscordUserId: session.discordUserId,
    },
  });

  await audit(session, "gm_turn_spent", characterId, { actionId: created.id, turn: openTurn.number });

  repaint(characterId);
  revalidatePath("/gm/turns");
  return { actionId: created.id };
}

// One recipient, so sendDm directly. deliverGmMessage in gm/actions.js exists
// for the sequential 100-recipient fan-out and would be the wrong shape here.
// sendDm writes the DirectMessage log row and applies the » prefix itself.
async function messageCharacterImpl({ characterId, message }) {
  const session = await requireGm();
  const character = await loadCharacter(characterId);
  const text = message?.trim();
  if (!text) throw new UserError("Write something first.");

  const sent = await sendDm(character.discordUserId, text).catch(() => null);
  await audit(session, sent ? "gm_dm_sent" : "gm_message_delivery_failed", characterId, {
    length: text.length,
  });
  if (!sent) throw new UserError("Discord wouldn't deliver that — they may have DMs closed.");

  revalidatePath(`/gm/messages/${character.discordUserId}`);
  repaint(characterId);
  return {};
}

// Pure repair: re-push everything Discord should already be showing. No DB
// writes of its own. Refused for a corpse — re-syncing a dead character is
// exactly the bug the death branch exists to avoid.
async function resyncDiscordImpl({ characterId }) {
  const session = await requireGm();
  const character = await loadCharacter(characterId);
  if (character.status !== "ALIVE") {
    throw new UserError("There's nothing to sync for a dead character.");
  }

  await audit(session, "gm_character_discord_resync", characterId, { name: character.name });

  after(async () => {
    try {
      await ensureCharacterRole(character);
      await syncCharacterNickname(character.discordUserId, formatBareName(character));
      await syncCharacterLocationAccess(character.discordUserId, null, character.locationId);
      await syncCharacterNarrowcastAccess(characterId);
    } catch (err) {
      console.error("Dev Panel resync failed:", err);
    }
  });

  repaint(characterId);
  return { name: character.name };
}

// The irreversible one. Discord cleanup runs FIRST and inline, while the row
// still names the overwrites and the personal role id; the database half is
// the shared deleteCharacterRow, which also detaches the audit trail rather
// than deleting it.
async function deleteCharacterImpl({ characterId, confirmName }) {
  const session = await requireSuperadminSession();
  const character = await loadCharacter(characterId);

  if ((confirmName ?? "").trim() !== character.name) {
    throw new UserError(`Type "${character.name}" exactly to confirm.`);
  }

  // Audited before the delete, with the FK detached, because targetCharacterId
  // is about to stop resolving.
  await prisma.auditLog.create({
    data: {
      actorDiscordUserId: session.discordUserId,
      actionType: "gm_character_deleted",
      details: {
        characterId,
        name: character.name,
        discordUserId: character.discordUserId,
        roleTitle: character.roleTitle,
        factionId: character.factionId,
        resources: character.resources,
      },
    },
  });

  await revokeAllCharacterAccess(character).catch((err) =>
    console.error("revokeAllCharacterAccess failed during delete:", err),
  );
  if (character.discordRoleId) {
    await deleteCharacterRole(character.discordRoleId).catch(() => {});
  }
  await updateGuildNickname(character.discordUserId, null).catch(() => {});

  await deleteCharacterRow(prisma, characterId);

  revalidatePath("/gm/players");
  revalidatePath("/gm/dev/characters");
  revalidatePath("/character");
  return { name: character.name };
}

// ── goals ──────────────────────────────────────────────────────────────────

// At most one ACTIVE Desire per character is an action-level invariant, not a
// schema one, so setting a new one cancels the old in the same transaction.
async function setDesireGmImpl({ characterId, text, points }) {
  const session = await requireGm();
  await loadCharacter(characterId);
  const body = (text ?? "").trim();
  if (!body) throw new UserError("A desire needs some text.");
  const value = Number.parseInt(points, 10);
  if (!Number.isInteger(value) || value < 1 || value > 5) {
    throw new UserError("A desire is worth between 1 and 5 points.");
  }

  const openTurn = await prisma.turn.findFirst({ where: { status: "OPEN" }, select: { number: true } });

  const desire = await prisma.$transaction(async (tx) => {
    await tx.desire.updateMany({
      where: { characterId, status: "ACTIVE" },
      data: { status: "CANCELLED", endedTurnNumber: openTurn?.number ?? null },
    });
    return tx.desire.create({
      data: { characterId, text: body, points: value, status: "ACTIVE", setTurnNumber: openTurn?.number ?? null },
    });
  });

  await audit(session, "gm_desire_set", characterId, { desireId: desire.id, points: value });
  repaint(characterId);
  return { desireId: desire.id };
}

async function endDesireGmImpl({ characterId, desireId, mode }) {
  const session = await requireGm();
  await loadCharacter(characterId);
  const desire = await prisma.desire.findUnique({ where: { id: desireId } });
  if (!desire || desire.characterId !== characterId) throw new UserError("That desire is gone.");
  if (desire.status !== "ACTIVE") throw new UserError("That desire has already ended.");

  const openTurn = await prisma.turn.findFirst({ where: { status: "OPEN" }, select: { number: true } });
  const fulfilling = mode === "fulfill";

  await prisma.$transaction(async (tx) => {
    await tx.desire.update({
      where: { id: desireId },
      data: {
        status: fulfilling ? "FULFILLED" : "CANCELLED",
        endedTurnNumber: openTurn?.number ?? null,
      },
    });
    // Fulfilling is the earn side of the point economy; cancelling pays
    // nothing (CHARACTERS.md).
    if (fulfilling) {
      await tx.character.update({
        where: { id: characterId },
        data: { tagPoints: { increment: desire.points } },
      });
    }
  });

  await audit(session, fulfilling ? "gm_desire_fulfilled" : "gm_desire_cancelled", characterId, {
    desireId,
    points: fulfilling ? desire.points : 0,
  });
  repaint(characterId);
  return { points: fulfilling ? desire.points : 0 };
}

// Fear is three columns on Character, not a model. Fulfilling costs a
// flat 3 points and stamps the turn that drives the one-turn cooldown.
const FEAR_COST = 3;

async function fulfillWorstFearGmImpl({ characterId }) {
  const session = await requireGm();
  const character = await loadCharacter(characterId);
  if (!character.fear) throw new UserError("They haven't set a fear.");

  const openTurn = await prisma.turn.findFirst({ where: { status: "OPEN" }, select: { number: true } });

  await prisma.character.update({
    where: { id: characterId },
    data: {
      tagPoints: { decrement: FEAR_COST },
      fearLastFulfilledTurn: openTurn?.number ?? null,
    },
  });

  await audit(session, "gm_worst_fear_fulfilled", characterId, {
    cost: FEAR_COST,
    turn: openTurn?.number ?? null,
  });
  repaint(characterId);
  return { cost: FEAR_COST };
}

// ── exported wrappers ──────────────────────────────────────────────────────

export async function applyCharacterEdits(input) {
  return guarded(() => applyCharacterEditsImpl(input));
}
export async function killCharacterNow(input) {
  return guarded(() => killCharacterNowImpl(input));
}
export async function reviveCharacter(input) {
  return guarded(() => reviveCharacterImpl(input));
}
export async function restoreTurn(input) {
  return guarded(() => restoreTurnImpl(input));
}
export async function spendTurn(input) {
  return guarded(() => spendTurnImpl(input));
}
export async function messageCharacter(input) {
  return guarded(() => messageCharacterImpl(input));
}
export async function resyncDiscord(input) {
  return guarded(() => resyncDiscordImpl(input));
}
export async function deleteCharacter(input) {
  return guarded(() => deleteCharacterImpl(input));
}
export async function setDesireGm(input) {
  return guarded(() => setDesireGmImpl(input));
}
export async function endDesireGm(input) {
  return guarded(() => endDesireGmImpl(input));
}
export async function fulfillWorstFearGm(input) {
  return guarded(() => fulfillWorstFearGmImpl(input));
}
