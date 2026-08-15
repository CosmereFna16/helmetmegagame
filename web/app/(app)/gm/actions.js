"use server";

import { revalidatePath } from "next/cache";
import { prisma, advanceTurn as advanceTurnInDb } from "@lifeweb/db";
import { getGmSession, postMessage, sendDm, listGuildChannels, isSummaryChannel } from "@/lib/discordGuild";

async function requireGm() {
  const { session, isGm: gm } = await getGmSession();
  if (!session?.discordUserId) throw new Error("Not authenticated.");
  if (!gm) throw new Error("Not authorized.");
  return session;
}

// Resolves Needs on the current turn (if any) and opens the next one —
// the same one-button "End Turn" the automated dawn/dusk cron uses, so a
// manual override behaves identically instead of splitting into a separate
// close-then-open flow a GM has to understand.
export async function endTurn() {
  const session = await requireGm();

  const { previousTurn, newTurn } = await advanceTurnInDb();

  await prisma.auditLog.create({
    data: {
      actorDiscordUserId: session.discordUserId,
      actionType: "turn_advanced",
      details: { previousTurnId: previousTurn?.id ?? null, newTurnId: newTurn.id, number: newTurn.number, phase: newTurn.phase },
    },
  });

  const day = Math.ceil(newTurn.number / 2);
  const label = newTurn.phase === "DAWN" ? "Dawn breaks" : "Dusk falls";
  const text = `${label} over Evergreen — Day ${day}, Turn ${newTurn.number} (${newTurn.phase}).`;
  const channels = await listGuildChannels();
  await Promise.all(
    channels.filter(isSummaryChannel).map((channel) => postMessage(channel.id, text).catch(() => {})),
  );

  revalidatePath("/", "layout");
}

// Shared by adjudicateAction (bundled with the adjudication submit) and
// sendAffectedParties (standalone, once an action is already adjudicated) —
// both collect the same parallel partyCharacterId[]/partyMessage[] fields
// from PartyRows and fire one DM per filled-in row.
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

export async function adjudicateAction(formData) {
  const session = await requireGm();

  const actionId = formData.get("actionId")?.toString();
  if (!actionId) return;
  const resultMessage = formData.get("resultMessage")?.toString().trim() || null;
  const gmNotes = formData.get("gmNotes")?.toString().trim() || null;
  const isPublic = formData.get("isPublic") === "on";

  const action = await prisma.action.findUnique({
    where: { id: actionId },
    include: { character: true },
  });
  if (!action || action.status !== "CONFIRMED") return;

  await prisma.action.update({
    where: { id: actionId },
    data: { status: "ADJUDICATED", resultMessage, gmNotes, isPublic },
  });

  if (resultMessage) {
    await sendDm(action.character.discordUserId, resultMessage).catch(() => {});
  }

  if (isPublic && resultMessage) {
    const channels = await listGuildChannels();
    const text = `**${action.character.name}** — ${action.description}\n${resultMessage}`;
    await Promise.all(
      channels.filter(isSummaryChannel).map((channel) => postMessage(channel.id, text).catch(() => {})),
    );
  }

  await prisma.auditLog.create({
    data: {
      actorDiscordUserId: session.discordUserId,
      actionType: "action_adjudicated",
      targetCharacterId: action.characterId,
      details: { actionId, isPublic },
    },
  });

  await sendPartyMessages(formData, session);

  revalidatePath("/gm/turns");
  revalidatePath("/character");
  revalidatePath("/gm/players");
}

export async function sendAffectedParties(formData) {
  const session = await requireGm();
  await sendPartyMessages(formData, session);
  revalidatePath("/gm/turns");
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
