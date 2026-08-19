"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@lifeweb/db";
import { getGmSession, sendDm } from "@/lib/discordGuild";

async function requireGm() {
  const { session, isGm: gm } = await getGmSession();
  if (!session?.discordUserId) throw new Error("Not authenticated.");
  if (!gm) throw new Error("Not authorized.");
  return session;
}

// Collects the parallel partyCharacterId[]/partyMessage[] fields PartyRows
// submits alongside updateMove and fires one DM per filled-in row.
async function sendPartyMessages(formData, session) {
  const characterIds = formData.getAll("partyCharacterId").map(String);
  const messages = formData.getAll("partyMessage").map(String);
  const pairs = characterIds
    .map((id, i) => ({ characterId: id, message: messages[i]?.trim() }))
    .filter((p) => p.characterId && p.message);
  if (pairs.length === 0) return;

  const characters = await prisma.character.findMany({
    where: { id: { in: pairs.map((p) => p.characterId) } },
  });
  const byId = new Map(characters.map((c) => [c.id, c]));

  await Promise.all(
    pairs.map((p) => {
      const character = byId.get(p.characterId);
      if (!character) return null;
      return sendDm(character.discordUserId, p.message).catch(() => null);
    }),
  );

  await prisma.auditLog.create({
    data: {
      actorDiscordUserId: session.discordUserId,
      actionType: "gm_message_sent",
      details: { pairs },
    },
  });
}

// Replaces the old auto-DM/auto-post adjudicateAction. Every field here is
// plainly editable from the Moves popup (MoveEditorModal) regardless of the
// Move's current submission-pipeline status — nothing here messages the
// player; that's now solely PartyRows/sendPartyMessages/sendGmMessage below,
// fired manually by the GM once they've written up Outcome/Other Notes.
export async function updateMove(formData) {
  const session = await requireGm();

  const actionId = formData.get("actionId")?.toString();
  if (!actionId) return;

  const moveKind = formData.get("moveKind")?.toString() || null;
  const opposed = formData.get("opposed") === "on";
  const moveReviewStatus = formData.get("moveReviewStatus")?.toString() || "OPEN";
  const resultMessage = formData.get("resultMessage")?.toString().trim() || null;
  const gmNotes = formData.get("gmNotes")?.toString().trim() || null;
  const resourceDelta = Number.parseInt(formData.get("resourceDelta")?.toString().trim() ?? "0", 10) || 0;

  const action = await prisma.action.findUnique({ where: { id: actionId } });
  if (!action) return;

  // Switching a Move's kind rerolls/nulls the d6 the same way the bot does
  // at confirm time — GAMBIT always carries a fresh roll, ROUTINE never has
  // one.
  let diceRoll = action.diceRoll;
  if (moveKind === "GAMBIT" && action.moveKind !== "GAMBIT") {
    diceRoll = 1 + Math.floor(Math.random() * 6);
  } else if (moveKind !== "GAMBIT" && action.moveKind === "GAMBIT") {
    diceRoll = null;
  }

  // The resource delta is only ever applied to the character's balance once
  // — the moment a Move first transitions into Solved — so re-opening and
  // re-saving an already-Solved Move doesn't double-apply it.
  const enteringSolved = moveReviewStatus === "SOLVED" && action.moveReviewStatus !== "SOLVED";

  await prisma.$transaction([
    prisma.action.update({
      where: { id: actionId },
      data: { moveKind, opposed, moveReviewStatus, resultMessage, gmNotes, resourceDelta, diceRoll },
    }),
    ...(enteringSolved && resourceDelta !== 0
      ? [prisma.character.update({ where: { id: action.characterId }, data: { resources: { increment: resourceDelta } } })]
      : []),
  ]);

  await prisma.auditLog.create({
    data: {
      actorDiscordUserId: session.discordUserId,
      actionType: "move_updated",
      targetCharacterId: action.characterId,
      details: { actionId, moveKind, opposed, moveReviewStatus },
    },
  });

  await sendPartyMessages(formData, session);

  revalidatePath("/gm/turns");
  revalidatePath("/character");
  revalidatePath("/gm/players");
}

export async function sendGmMessage(formData) {
  const session = await requireGm();

  const characterIds = formData.getAll("characterId").map(String).filter(Boolean);
  const message = formData.get("message")?.toString().trim();
  if (!message || characterIds.length === 0) return;

  const characters = await prisma.character.findMany({ where: { id: { in: characterIds } } });
  await Promise.all(
    characters.map((character) => sendDm(character.discordUserId, message).catch(() => null)),
  );

  await prisma.auditLog.create({
    data: {
      actorDiscordUserId: session.discordUserId,
      actionType: "gm_message_sent",
      details: { characterIds, message },
    },
  });

  revalidatePath("/gm/players");
  revalidatePath("/gm/turns");
}

export async function sendDmReply(formData) {
  const session = await requireGm();

  const discordUserId = formData.get("discordUserId")?.toString().trim();
  const message = formData.get("message")?.toString().trim();
  if (!discordUserId || !message) return;

  await sendDm(discordUserId, message);

  await prisma.auditLog.create({
    data: {
      actorDiscordUserId: session.discordUserId,
      actionType: "gm_dm_reply",
      details: { discordUserId, message },
    },
  });

  revalidatePath("/gm/messages");
  revalidatePath(`/gm/messages/${discordUserId}`);
}

export async function resetCharacterMood(formData) {
  const session = await requireGm();
  const characterId = formData.get("characterId")?.toString();
  if (!characterId) return;

  await prisma.character.update({
    where: { id: characterId },
    data: { moodState: "NEUTRAL", moodNote: null, moodExpiresTurn: null },
  });

  await prisma.auditLog.create({
    data: {
      actorDiscordUserId: session.discordUserId,
      actionType: "mood_gm_reset",
      targetCharacterId: characterId,
    },
  });

  revalidatePath("/gm/players");
}
