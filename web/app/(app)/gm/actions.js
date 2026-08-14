"use server";

import { revalidatePath } from "next/cache";
import { prisma, resolveNeeds } from "@lifeweb/db";
import { getGmSession, postMessage, sendDm, listGuildChannels, isSummaryChannel } from "@/lib/discordGuild";

async function requireGm() {
  const { session, isGm: gm } = await getGmSession();
  if (!session?.discordUserId) throw new Error("Not authenticated.");
  if (!gm) throw new Error("Not authorized.");
  return session;
}

async function getConfig() {
  return prisma.gameConfig.upsert({
    where: { id: 1 },
    update: {},
    create: { id: 1 },
  });
}

export async function setMovesChannel(formData) {
  await requireGm();
  const channelId = formData.get("channelId")?.toString().trim() || null;

  await getConfig();
  await prisma.gameConfig.update({ where: { id: 1 }, data: { movesChannelId: channelId } });
  revalidatePath("/gm/turns");
}

export async function openTurn() {
  const session = await requireGm();

  const existingOpen = await prisma.turn.findFirst({ where: { status: "OPEN" } });
  if (existingOpen) return;

  const lastTurn = await prisma.turn.findFirst({ orderBy: { number: "desc" } });
  const phase = !lastTurn || lastTurn.phase === "DUSK" ? "DAWN" : "DUSK";

  const turn = await prisma.turn.create({
    data: {
      number: (lastTurn?.number ?? 0) + 1,
      phase,
      gameDate: new Date(),
      status: "OPEN",
    },
  });

  await prisma.auditLog.create({
    data: {
      actorDiscordUserId: session.discordUserId,
      actionType: "turn_opened",
      details: { turnId: turn.id, number: turn.number, phase: turn.phase },
    },
  });

  revalidatePath("/", "layout");
}

export async function closeTurn() {
  const session = await requireGm();

  const openTurnRecord = await prisma.turn.findFirst({ where: { status: "OPEN" } });
  if (!openTurnRecord) return;

  const config = await getConfig();
  await resolveNeeds(openTurnRecord, config);

  await prisma.turn.update({
    where: { id: openTurnRecord.id },
    data: { status: "RESOLVED", resolvedAt: new Date() },
  });

  await prisma.auditLog.create({
    data: {
      actorDiscordUserId: session.discordUserId,
      actionType: "turn_closed",
      details: { turnId: openTurnRecord.id, number: openTurnRecord.number },
    },
  });

  revalidatePath("/", "layout");
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

  revalidatePath("/gm/turns");
  revalidatePath("/character");
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
