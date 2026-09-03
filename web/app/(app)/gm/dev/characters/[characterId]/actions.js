"use server";

import { revalidatePath } from "next/cache";
import { TURNS_PATH } from "@/lib/routes";
import { after } from "next/server";
import { afterInventoryChange } from "@/lib/afterInventoryChange";
import { prisma, isDynastyHead, deleteCharacterRow } from "@lifeweb/db";
import { UserError, guarded } from "@/lib/actionResult";
import { isSuperadmin } from "@/lib/superadmin";
import {
  getGmSession,
  ensureCharacterRole,
  syncCharacterNickname,
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
import { applyLocationMoveSideEffects } from "@lifeweb/db/lib/locationMove";
import { syncCharacterRoomAccess } from "@lifeweb/db/lib/roomAccess";
import { rollCavingOnArrival } from "@lifeweb/db/lib/cavingPass";
import { findOpenTurnAction, lockIsLive, deleteActionRestoringTurn } from "@/lib/moveEconomy";
import { gmTransferResources } from "@/lib/gmTransfer";

// Dev Panel microactions, gated on GM membership; delete requires superadmin
// (see requireSuperadminSession).
//
// Use UserError, not a bare throw: Next redacts a thrown Error from a server
// action into React #441 in production (web/lib/actionResult.js).
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

// Notifies the player a microaction touched their sheet. Not a Request —
// a one-way notification, never part of the Request lifecycle.
function notifyCharacter(session, character, text) {
  notifyCharacterShared(character, text, {
    authorDiscordUserId: session.discordUserId,
    source: "gm_dev",
  });
}

// The one staged-apply action.

// Stages every core/tag edit from the panel into one transaction, one audit
// row, one repaint. expectedUpdatedAt is an optimistic lock: a losing GM is
// told to reload rather than silently overwritten.
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
    // Row lock: Postgres runs READ COMMITTED, so without this an Apply and a
    // player's equip tap can both pass a stale equip-slot count.
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

  // Discord effects run in after(), post-commit: none of these REST calls may
  // hold the transaction or the Apply button.
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
      // Sequential; a failed step is logged and must not block the rest.
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
            await applyLocationMoveSideEffects(prisma, {
              characterId,
              fromLocationId: diff.locationId?.from ?? null,
              toLocationId: updated.locationId,
            });
          }
          if (step === "narrowcast") await syncCharacterNarrowcastAccess(characterId);
          if (step === "rooms") await syncCharacterRoomAccess(prisma, updated);
        } catch (err) {
          console.error(`Dev Panel Discord step "${step}" failed for ${characterId}:`, err);
        }
      }
    });
  }

  const changeLines = [];
  const tagGains = appliedTags.filter((t) => t.op === "add").map((t) => t.name ?? t.tagId);
  const tagLosses = appliedTags.filter((t) => t.op === "remove").map((t) => t.name ?? t.tagId);
  if (tagGains.length) changeLines.push(`+ ${tagGains.join(", ")}`);
  if (tagLosses.length) changeLines.push(`- ${tagLosses.join(", ")}`);
  if (diff.resources) changeLines.push(`Resources: ${diff.resources.from} → ${diff.resources.to} ⬢`);
  if (diff.locationId) changeLines.push(`Moved.`);
  if (diff.name || diff.lastName) changeLines.push(`Name updated.`);
  if (changeLines.length) {
    notifyCharacter(session, existing, `Your sheet was edited:\n${changeLines.join("\n")}`);
  }

  repaint(characterId);
  if (diff.factionId || leader !== null || diff.isTreasurer) revalidatePath("/faction");

  return { name: data.name ?? existing.name, applied: diff, tags: appliedTags, discord: steps };
}

// Microactions: each a verb, idempotency-checked against live state.

// killCharacter revokes every channel overwrite, deletes the personal
// Discord role, clears the nickname, grants Cursed, writes DEATH.
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

// Inverse of kill: restores role, channel access, and clears Cursed. The old
// zone is passed as null since kill already stripped every access grant.
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
      // fromLocationId null: kill already stripped every grant, so this is a
      // restore, and the shared fan-out re-grants both roles plus rooms.
      await applyLocationMoveSideEffects(prisma, {
        characterId,
        fromLocationId: null,
        toLocationId: updated.locationId,
      });
      await syncCharacterNarrowcastAccess(characterId);
    } catch (err) {
      console.error("Revive Discord restore failed:", err);
    }
  });

  repaint(characterId);
  return { name: character.name };
}

// Giving the turn back means deleting the Action row (web/lib/moveEconomy.js).
async function restoreTurnImpl({ characterId, reason }) {
  const session = await requireGm();
  const character = await loadCharacter(characterId);
  const { action } = await findOpenTurnAction(prisma, characterId);
  if (!action) throw new UserError(`${character.name} hasn't acted this turn.`);

  // Don't yank a Move out from under a GM who has it open in /gm/turns.
  if (lockIsLive(action) && action.lockedByDiscordUserId !== session.discordUserId) {
    throw new UserError("Another GM is adjudicating that Move right now.");
  }

  // A lesson's partner Moves may go with this one (db/lib/lessons.js); the
  // learners it strands are told after commit.
  let lessonDms = [];
  await prisma.$transaction(async (tx) => {
    lessonDms = await deleteActionRestoringTurn(tx, action);
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
  for (const dm of lessonDms) {
    after(() => sendDm(dm.discordUserId, dm.content).catch((err) => console.error("Lesson cancel DM failed:", err)));
  }
  });

  // Always DM'd — a freed turn they don't know about is a wasted day.
  notifyCharacter(
    session,
    character,
    `Your Move was returned to you — you can act again this turn.${reason?.trim() ? `\n${reason.trim()}` : ""}`,
  );

  repaint(characterId);
  revalidatePath(TURNS_PATH, "page");
  return { description: action.description };
}

// Files a stub Move so the economy sees them as having acted, worth nothing
// so Restore-turn has nothing to claw back.
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

// Character-to-character transfer; gmTransferResources/resolveParty reject a
// malformed or unknown key. Same balance check as a player transfer, minus
// the player-side reach gate.
async function transferResourcesImpl({ fromKey, toKey, amount, reason }) {
  const result = await gmTransferResources({ fromKey, toKey, amount, reason });
  for (const key of [fromKey, toKey]) {
    const [kind, id] = (key ?? "").split(":");
    if (kind === "character" && id) repaint(id);
  }
  return result;
}

// One recipient, so sendDm directly (sendGmBroadcast handles the fan-out
// case). sendDm logs the DirectMessage row and applies the » prefix.
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

// Pure repair: re-pushes what Discord should already be showing. Refused for
// a corpse.
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
      await applyLocationMoveSideEffects(prisma, {
        characterId,
        fromLocationId: null,
        toLocationId: character.locationId,
      });
      await afterInventoryChange(characterId);
    } catch (err) {
      console.error("Dev Panel resync failed:", err);
    }
  });

  repaint(characterId);
  return { name: character.name };
}

// A raw relocation like Bulk Move's: no Move cost, no Action, no adjacency
// check, and no cooldown stamp. Immediate, not staged, since it only touches
// where the character stands.
async function teleportCharacterImpl({ characterId, locationId }) {
  const session = await requireGm();
  const character = await loadCharacter(characterId);
  if (character.status !== "ALIVE") throw new UserError("A corpse can't be moved.");

  const location = locationId
    ? await prisma.location.findUnique({ where: { id: locationId }, include: { zone: true } })
    : null;
  if (locationId && !location) throw new UserError("That location no longer exists. ‡");
  if (character.locationId === (locationId || null)) {
    throw new UserError(`${character.name} is already there.`);
  }

  const fromLocationId = character.locationId;
  // The denormalization contract: locationId and zoneId are written together.
  const updated = await prisma.character.update({
    where: { id: characterId },
    data: { locationId: locationId || null, zoneId: location?.zoneId ?? null },
  });

  await audit(session, "gm_character_teleported", characterId, {
    fromLocationId,
    toLocationId: updated.locationId,
    toLocationName: location?.name ?? null,
    toZoneId: updated.zoneId,
    toZoneName: location?.zone?.name ?? null,
  });
  notifyCharacter(
    session,
    character,
    location
      ? `You were moved to ${location.name}.`
      : "You were moved somewhere with no channel access. ‡",
  );

  after(async () => {
    try {
      if (updated.locationId) {
        await applyLocationMoveSideEffects(prisma, {
          characterId,
          fromLocationId,
          toLocationId: updated.locationId,
        });
      } else {
        await afterInventoryChange(characterId);
      }
    } catch (err) {
      console.error("Dev Panel teleport Discord sync failed:", err);
    }
    // Rolls the Caving Die on arrival like walking in does (CAVING.md). Keyed
    // on the ZONE, not the location. Sent plainly, not via notifyCharacter —
    // the die speaks, not the GM.
    const cavingDm = await rollCavingOnArrival(prisma, updated, location?.zone ?? null);
    if (cavingDm) {
      await sendDm(cavingDm.discordUserId, cavingDm.content).catch((err) =>
        console.error("Dev Panel teleport: caving arrival DM failed:", err),
      );
    }
  });

  repaint(characterId);
  return { locationName: location?.name ?? null, zoneName: location?.zone?.name ?? null };
}

// Irreversible. Discord cleanup runs first while the row still has the
// overwrites and role id; deleteCharacterRow detaches the audit trail rather
// than deleting it.
async function deleteCharacterImpl({ characterId, confirmName }) {
  const session = await requireSuperadminSession();
  const character = await loadCharacter(characterId);

  if ((confirmName ?? "").trim() !== character.name) {
    throw new UserError(`Type "${character.name}" exactly to confirm.`);
  }

  // Audited before the delete — targetCharacterId is about to stop resolving.
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

// GM awards a Desire like a player claim, but gates are bypassed entirely
// (catalog: {slotIndex,slug}; free-text: {slotIndex,text,points}, 1-7).
// Bookkeeping still runs, so normal cooldowns start.
async function awardDesireGmImpl({ characterId, slotIndex: rawSlotIndex, slug, text, points }) {
  const session = await requireGm();
  const character = await loadCharacter(characterId);

  const config = await prisma.gameConfig.findUnique({ where: { id: 1 }, select: { desireSlots: true } });
  const desireSlots = config?.desireSlots ?? 2;
  const slotIndex = Number.parseInt(rawSlotIndex, 10);
  if (!Number.isInteger(slotIndex) || slotIndex < 0 || slotIndex >= desireSlots) {
    throw new UserError("That Desire slot doesn't exist.");
  }

  const catalogSlug = slug?.toString().trim();
  let body;
  let value;
  let templateId = null;

  if (catalogSlug) {
    const template = await prisma.desireTemplate.findUnique({ where: { slug: catalogSlug } });
    if (!template) throw new UserError("Unknown Desire template.");
    templateId = template.id;
    body = template.name;
    value = template.tier;
  } else {
    body = (text ?? "").trim();
    if (!body) throw new UserError("A desire needs some text.");
    value = Number.parseInt(points, 10);
    if (!Number.isInteger(value) || value < 1 || value > 7) {
      throw new UserError("A desire is worth between 1 and 7 points.");
    }
  }

  const openTurn = await prisma.turn.findFirst({ where: { status: "OPEN" }, select: { number: true } });

  // Same row lock as the player's claimDesireImpl, so a GM award landing at
  // the same moment as a player's own claim serializes rather than both
  // reading the same tagPoints and one overwriting the other.
  const desire = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "Character" WHERE "id" = ${characterId} FOR UPDATE`;
    const row = await tx.desire.create({
      data: {
        characterId,
        templateId,
        slotIndex,
        text: body,
        points: value,
        status: "FULFILLED",
        setTurnNumber: openTurn?.number ?? null,
        endedTurnNumber: openTurn?.number ?? null,
      },
    });
    await tx.character.update({
      where: { id: characterId },
      data: { tagPoints: { increment: value } },
    });
    return row;
  });

  await audit(session, "gm_desire_fulfilled", characterId, {
    desireId: desire.id,
    points: value,
    slotIndex,
    templateId,
  });
  notifyCharacter(
    session,
    character,
    `Desire fulfilled: "${body}" (+${value} tag point${value === 1 ? "" : "s"})`,
  );
  repaint(characterId);
  return { desireId: desire.id };
}

// Dev Panel twin of undoing a FULFILL_DESIRE request. Clearing
// endedTurnNumber frees the slot; points reverse even if it goes negative.
async function revokeDesireGmImpl({ characterId, desireId }) {
  const session = await requireGm();
  const character = await loadCharacter(characterId);
  const desire = await prisma.desire.findUnique({ where: { id: desireId } });
  if (!desire || desire.characterId !== characterId) throw new UserError("That desire is gone.");
  if (desire.status === "CANCELLED") throw new UserError("That desire was already revoked.");

  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "Character" WHERE "id" = ${characterId} FOR UPDATE`;
    const { count } = await tx.desire.updateMany({
      where: { id: desireId, characterId, status: { not: "CANCELLED" } },
      data: { status: "CANCELLED", endedTurnNumber: null },
    });
    // Guarded against a race: two Revokes fired together would both pass the
    // read above, and only the one that actually flipped the row may take
    // the points back.
    if (count === 0) throw new UserError("That desire was already revoked.");
    if (desire.status === "FULFILLED") {
      await tx.character.update({
        where: { id: characterId },
        data: { tagPoints: { decrement: desire.points } },
      });
    }
  });

  await audit(session, "gm_desire_cancelled", characterId, {
    desireId,
    points: desire.status === "FULFILLED" ? desire.points : 0,
  });
  notifyCharacter(session, character, `Desire revoked: "${desire.text}"`);
  repaint(characterId);
  return { points: desire.status === "FULFILLED" ? desire.points : 0 };
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
export async function awardDesireGm(input) {
  return guarded(() => awardDesireGmImpl(input));
}
export async function revokeDesireGm(input) {
  return guarded(() => revokeDesireGmImpl(input));
}
