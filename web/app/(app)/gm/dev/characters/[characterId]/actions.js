"use server";

import { revalidatePath } from "next/cache";
import { TURNS_PATH } from "@/lib/routes";
import { after } from "next/server";
import { prisma, isDynastyHead, deleteCharacterRow } from "@lifeweb/db";
import { UserError, guarded } from "@/lib/actionResult";
import { isSuperadmin } from "@/lib/superadmin";
import {
  getGmSession,
  ensureCharacterRole,
  syncCharacterNickname,
  syncCharacterZoneRole,
  syncCharacterNarrowcastAccess,
  revokeAllCharacterAccess,
  deleteCharacterRole,
  updateGuildNickname,
  removeCursedRole,
  killCharacter,
  sendDm,
} from "@/lib/discordGuild";
import { notifyCharacter as notifyCharacterShared } from "@/lib/notifyCharacter";
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
import { applyPendingInvites } from "@lifeweb/db/lib/threadInvites";
import { rollCavingOnArrival } from "@lifeweb/db/lib/cavingPass";
import { findOpenTurnAction, lockIsLive, deleteActionRestoringTurn } from "@/lib/moveEconomy";
import { gmTransferResources } from "@/lib/gmTransfer";

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
  revalidatePath("/gm/players", "layout");
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

// Every microaction that changes something a player would otherwise only
// discover by re-opening their sheet tells them so — a dev-panel edit is
// still a thing that happened to their character. Called from `after()`,
// post-commit, same posture as the Discord-sync steps above: a DM must never
// hold up the button, and a failed one must never undo what already
// happened. Not a Request — this is a notification, not something the
// player responds to, so it never touches the Request lifecycle.
function notifyCharacter(session, character, text) {
  notifyCharacterShared(character, text, {
    authorDiscordUserId: session.discordUserId,
    source: "gm_dev",
  });
}

// The one staged-apply action.

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
  // walks every channel a character can reach, syncCharacterZoneRole is a role
  // grant plus a revoke, and propagateDynastyLastName is two REST calls per
  // living family member — none of that may hold the transaction, and none of
  // it should hold the Apply button either. Same posture as forceAdvanceTurn.
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
          if (step === "zone") {
            await syncCharacterZoneRole(
              updated.discordUserId,
              diff.zoneId?.from ?? null,
              updated.zoneId,
            );
          }
          if (step === "narrowcast") await syncCharacterNarrowcastAccess(characterId);
        } catch (err) {
          console.error(`Dev Panel Discord step "${step}" failed for ${characterId}:`, err);
        }
      }
    });
  }

  // Summarise what actually changed — tags first (the part most likely to
  // matter to a player), then the plain fields, skipping the transaction's
  // own bookkeeping (updatedAt and the like never surface here anyway since
  // diffCore only diffs edited fields).
  const changeLines = [];
  const tagGains = appliedTags.filter((t) => t.op === "add").map((t) => t.name ?? t.tagId);
  const tagLosses = appliedTags.filter((t) => t.op === "remove").map((t) => t.name ?? t.tagId);
  if (tagGains.length) changeLines.push(`+ ${tagGains.join(", ")}`);
  if (tagLosses.length) changeLines.push(`- ${tagLosses.join(", ")}`);
  if (diff.resources) changeLines.push(`Resources: ${diff.resources.from} → ${diff.resources.to} ⬢`);
  if (diff.zoneId) changeLines.push(`Moved.`);
  if (diff.name || diff.lastName) changeLines.push(`Name updated.`);
  if (changeLines.length) {
    notifyCharacter(session, existing, `Your sheet was edited:\n${changeLines.join("\n")}`);
  }

  repaint(characterId);
  if (diff.factionId || leader !== null || diff.isTreasurer) revalidatePath("/faction");

  return { name: data.name ?? existing.name, applied: diff, tags: appliedTags, discord: steps };
}

// Microactions. Each is a verb, fires on its own, and is idempotency-checked
// against live state rather than trusting the UI to have disabled its button.

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

  // killCharacter sends the death DM itself (web/lib/discordGuild.js), with
  // this reason folded in — a second notifyCharacter here would double it up.
  after(() =>
    killCharacter(updated, reason).catch((err) => console.error("killCharacter failed:", err)),
  );

  repaint(characterId);
  revalidatePath(TURNS_PATH, "page");
  return { name: character.name };
}

// The inverse, which the old editor never had: setting a corpse back to ALIVE
// left it with no personal role, no channel access and the Cursed role still
// on the account.
//
// The old zone is passed as null deliberately — killCharacter already stripped
// every role and overwrite, so this is a pure re-grant with nothing to move
// away from.
async function reviveCharacterImpl({ characterId }) {
  const session = await requireGm();
  const character = await loadCharacter(characterId);
  if (character.status === "ALIVE") throw new UserError(`${character.name} is already alive.`);

  const updated = await prisma.character.update({
    where: { id: characterId },
    // buriedAt goes with the status: a revived character must never be a live
    // person still marked buried, which would leave them un-lootable and
    // missing from every zone target menu (BURY_CHARACTER, REQUESTS.md §5d).
    data: { status: "ALIVE", buriedAt: null },
  });

  await audit(session, "gm_character_revived", characterId, { name: character.name });
  notifyCharacter(session, character, `${character.name} has been revived.`);

  after(async () => {
    try {
      await removeCursedRole(updated.discordUserId);
      await ensureCharacterRole(updated);
      await syncCharacterNickname(updated.discordUserId, formatBareName(updated));
      await syncCharacterZoneRole(updated.discordUserId, null, updated.zoneId);
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
async function restoreTurnImpl({ characterId, reason }) {
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

  // Always DM'd, not optional — a freed turn they don't know about is a
  // wasted day. Plain notification, not a Request: nothing here rides the
  // request lifecycle.
  notifyCharacter(
    session,
    character,
    `Your Move was returned to you — you can act again this turn.${reason?.trim() ? `\n${reason.trim()}` : ""}`,
  );

  repaint(characterId);
  revalidatePath(TURNS_PATH, "page");
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
  notifyCharacter(
    session,
    character,
    `Your turn was spent for you today.${description?.trim() ? `\n${description.trim()}` : ""}`,
  );

  repaint(characterId);
  revalidatePath(TURNS_PATH, "page");
  return { actionId: created.id };
}

// Immediate, not staged — see web/lib/gmTransfer.js's own comment for why. A
// GM can pay this character out of a faction Silo ("pay") or pull ⬢ from
// them into one ("collect"), without the player-side reach gate (a GM isn't
// standing anywhere) but with the same balance check every transfer gets.
async function transferResourcesImpl({ characterId, factionId, direction, amount, reason }) {
  const character = await loadCharacter(characterId);
  const characterKey = `character:${characterId}`;
  const factionKey = `faction:${factionId}`;
  const result = await gmTransferResources({
    fromKey: direction === "collect" ? characterKey : factionKey,
    toKey: direction === "collect" ? factionKey : characterKey,
    amount,
    reason,
  });
  repaint(characterId);
  revalidatePath("/faction");
  return { name: character.name, ...result };
}

// One recipient, so sendDm directly. sendGmBroadcast in gm/messages/actions.js
// exists for the sequential 100-recipient fan-out and would be the wrong shape
// here.
// sendDm writes the DirectMessage log row and applies the » prefix itself.
async function messageCharacterImpl({ characterId, message }) {
  const session = await requireGm();
  const character = await loadCharacter(characterId);
  const text = message?.trim();
  if (!text) throw new UserError("Write something first.");

  const sent = await sendDm(character.discordUserId, text, {
    authorDiscordUserId: session.discordUserId,
    source: "gm_dev",
  }).catch(() => null);
  await audit(session, sent ? "gm_dm_sent" : "gm_message_delivery_failed", characterId, {
    length: text.length,
  });
  if (!sent) throw new UserError("Discord wouldn't deliver that — they may have DMs closed.");

  revalidatePath(`/gm/players/${character.discordUserId}`);
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
      await syncCharacterZoneRole(character.discordUserId, null, character.zoneId);
      await syncCharacterNarrowcastAccess(characterId);
    } catch (err) {
      console.error("Dev Panel resync failed:", err);
    }
  });

  repaint(characterId);
  return { name: character.name };
}

// A raw relocation like Bulk Move's, not travel: no Move cost, no Action
// filed, no adjacency check. Immediate rather than staged — it touches only
// zoneId, so it can't race the staged form's own zone field, same posture as
// Kill/Revive owning `status`.
async function teleportCharacterImpl({ characterId, zoneId }) {
  const session = await requireGm();
  const character = await loadCharacter(characterId);
  if (character.status !== "ALIVE") throw new UserError("A corpse can't be moved.");

  const zone = zoneId ? await prisma.zone.findUnique({ where: { id: zoneId } }) : null;
  if (zoneId && !zone) throw new UserError("That zone no longer exists.");
  if (zone?.kind === "CAVE_GROUP") throw new UserError("That isn't a place a character can stand.");
  if (character.zoneId === (zoneId || null)) {
    throw new UserError(`${character.name} is already there.`);
  }

  const fromZoneId = character.zoneId;
  const updated = await prisma.character.update({
    where: { id: characterId },
    data: { zoneId: zoneId || null },
  });

  await audit(session, "gm_character_teleported", characterId, {
    fromZoneId,
    toZoneId: updated.zoneId,
    toZoneName: zone?.name ?? null,
  });
  notifyCharacter(
    session,
    character,
    zone ? `You were moved to ${zone.name}.` : "You were moved somewhere with no zone access.",
  );

  after(async () => {
    try {
      await syncCharacterZoneRole(updated.discordUserId, fromZoneId, updated.zoneId);
      await syncCharacterNarrowcastAccess(characterId);
      await applyPendingInvites(prisma, updated);
    } catch (err) {
      console.error("Dev Panel teleport Discord sync failed:", err);
    }
    // A GM dropping someone into the Depths rolls the Caving Die exactly like
    // walking in does — see docs/systemdocs/CAVING.md. Null on any zone that
    // isn't a cave level, or if they'd already rolled this turn. Sent plainly
    // rather than through notifyCharacter(): the die is the game speaking,
    // not the GM, so it carries no gm_dev attribution.
    const cavingDm = await rollCavingOnArrival(prisma, updated, zone);
    if (cavingDm) {
      await sendDm(cavingDm.discordUserId, cavingDm.content).catch((err) =>
        console.error("Dev Panel teleport: caving arrival DM failed:", err),
      );
    }
  });

  repaint(characterId);
  return { zoneName: zone?.name ?? null };
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

  // Checked, not discarded: once the Character row goes there is no id left to
  // clean up with, so a revoke that quietly did nothing leaves overwrites on
  // every channel forever. See db/lib/accessSweep.js.
  const revoked = await revokeAllCharacterAccess(character).catch((err) => {
    console.error("revokeAllCharacterAccess failed during delete:", err);
    return null;
  });
  if (!revoked || revoked.failed > 0) {
    console.error(
      `Deleting ${character.name}: ${revoked?.failed ?? "all"} channel overwrites were NOT removed. ` +
        `They may still be able to read those rooms.`,
    );
  }
  if (character.discordRoleId) {
    await deleteCharacterRole(character.discordRoleId).catch(() => {});
  }
  await updateGuildNickname(character.discordUserId, null).catch(() => {});

  await deleteCharacterRow(prisma, characterId);

  revalidatePath("/gm/players", "layout");
  revalidatePath("/gm/dev/characters");
  revalidatePath("/character");
  return { name: character.name };
}

// At most GameConfig.maxActiveDesires ACTIVE Desires per character is an
// action-level invariant, not a schema one — so it is re-checked here rather
// than left to the player-side action. A GM at the cap cancels one first;
// setting no longer silently ends the previous Desire, which would be a hidden
// loss now that several can run at once.
async function setDesireGmImpl({ characterId, text, points }) {
  const session = await requireGm();
  const character = await loadCharacter(characterId);
  const body = (text ?? "").trim();
  if (!body) throw new UserError("A desire needs some text.");
  const value = Number.parseInt(points, 10);
  if (!Number.isInteger(value) || value < 1 || value > 5) {
    throw new UserError("A desire is worth between 1 and 5 points.");
  }

  const [openTurn, config] = await Promise.all([
    prisma.turn.findFirst({ where: { status: "OPEN" }, select: { number: true } }),
    prisma.gameConfig.findUnique({ where: { id: 1 }, select: { maxActiveDesires: true } }),
  ]);
  const maxActive = config?.maxActiveDesires ?? 3;

  // Same row lock as the player's setDesire: count and create together.
  const desire = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "Character" WHERE "id" = ${characterId} FOR UPDATE`;
    const activeCount = await tx.desire.count({ where: { characterId, status: "ACTIVE" } });
    if (activeCount >= maxActive) {
      throw new UserError(
        `${character.name} already holds ${activeCount} active Desire${activeCount === 1 ? "" : "s"} (the limit is ${maxActive}). Fulfil or cancel one first.`,
      );
    }
    return tx.desire.create({
      data: { characterId, text: body, points: value, status: "ACTIVE", setTurnNumber: openTurn?.number ?? null },
    });
  });

  await audit(session, "gm_desire_set", characterId, { desireId: desire.id, points: value });
  notifyCharacter(session, character, `New Desire (worth ${value} pt${value === 1 ? "" : "s"}):\n${body}`);
  repaint(characterId);
  return { desireId: desire.id };
}

async function endDesireGmImpl({ characterId, desireId, mode }) {
  const session = await requireGm();
  const character = await loadCharacter(characterId);
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
  notifyCharacter(
    session,
    character,
    fulfilling
      ? `Desire fulfilled: "${desire.text}" (+${desire.points} tag point${desire.points === 1 ? "" : "s"})`
      : `Desire cancelled: "${desire.text}"`,
  );
  repaint(characterId);
  return { points: fulfilling ? desire.points : 0 };
}

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
export async function transferResources(input) {
  return guarded(() => transferResourcesImpl(input));
}
export async function messageCharacter(input) {
  return guarded(() => messageCharacterImpl(input));
}
export async function resyncDiscord(input) {
  return guarded(() => resyncDiscordImpl(input));
}
export async function teleportCharacter(input) {
  return guarded(() => teleportCharacterImpl(input));
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
