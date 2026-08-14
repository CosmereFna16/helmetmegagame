"use server";

import { revalidatePath } from "next/cache";
import sharp from "sharp";
import { redirect } from "next/navigation";
import { prisma } from "@lifeweb/db";
import { auth } from "@/lib/auth";
import { sendDm } from "@/lib/discordGuild";
import { APPEARANCE_MAX_LENGTH } from "@/lib/constants";

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const AVATAR_SIZE = 256;

export async function updateCharacterProfile(formData) {
  const session = await auth();
  if (!session?.discordUserId) redirect("/");

  const character = await prisma.character.findFirst({
    where: { discordUserId: session.discordUserId, status: "ALIVE" },
  });
  if (!character) redirect("/character/new");

  const name = formData.get("name")?.toString().trim();
  const appearance =
    formData.get("appearance")?.toString().trim().slice(0, APPEARANCE_MAX_LENGTH) || null;
  const avatar = formData.get("avatar");

  const data = { appearance };
  if (name) data.name = name;

  if (avatar && avatar.size > 0) {
    if (avatar.size > MAX_UPLOAD_BYTES) {
      throw new Error("Avatar image must be under 5MB.");
    }
    const buffer = Buffer.from(await avatar.arrayBuffer());
    data.avatarData = await sharp(buffer)
      .resize(AVATAR_SIZE, AVATAR_SIZE, { fit: "cover" })
      .webp({ quality: 85 })
      .toBuffer();
    data.avatarMimeType = "image/webp";
  }

  await prisma.character.update({ where: { id: character.id }, data });
  revalidatePath("/character");
}

export async function submitAction(formData) {
  const session = await auth();
  if (!session?.discordUserId) redirect("/");

  const character = await prisma.character.findFirst({
    where: { discordUserId: session.discordUserId, status: "ALIVE" },
  });
  if (!character) redirect("/character/new");

  const type = formData.get("type")?.toString();
  const description = formData.get("description")?.toString().trim();
  if (type !== "EFFORT" && type !== "MOVE") return;
  if (!description) return;

  const openTurn = await prisma.turn.findFirst({ where: { status: "OPEN" } });
  if (!openTurn) return;

  const existing = await prisma.action.findFirst({
    where: { characterId: character.id, turnId: openTurn.id },
  });
  if (existing) return;

  const action = await prisma.action.create({
    data: {
      characterId: character.id,
      turnId: openTurn.id,
      type,
      description,
      zoneId: character.zoneId,
      status: "PENDING",
    },
  });

  const kind = type === "MOVE" ? "Move" : "Effort";
  const dm = await sendDm(
    character.discordUserId,
    `**${kind} submitted:** ${description}\n\nReact with ✅ on this message to confirm and lock it in.`,
  ).catch(() => null);

  if (dm) {
    await prisma.action.update({
      where: { id: action.id },
      data: { confirmDmMessageId: dm.id },
    });
  }

  await prisma.auditLog.create({
    data: {
      actorDiscordUserId: session.discordUserId,
      actionType: "action_submitted",
      targetCharacterId: character.id,
      details: { actionId: action.id, type, dmSent: !!dm },
    },
  });

  revalidatePath("/character");
}

export async function setMood(formData) {
  const session = await auth();
  if (!session?.discordUserId) redirect("/");

  const character = await prisma.character.findFirst({
    where: { discordUserId: session.discordUserId, status: "ALIVE" },
  });
  if (!character) redirect("/character/new");

  const moodState = formData.get("moodState")?.toString();
  if (!["NEUTRAL", "HAPPY", "UNHAPPY"].includes(moodState)) return;
  const moodNote = formData.get("moodNote")?.toString().trim() || null;

  let moodExpiresTurn = null;
  if (moodState !== "NEUTRAL") {
    const [config, openTurn] = await Promise.all([
      prisma.gameConfig.findUnique({ where: { id: 1 } }),
      prisma.turn.findFirst({ where: { status: "OPEN" } }),
    ]);
    if (openTurn) moodExpiresTurn = openTurn.number + (config?.moodDurationTurns ?? 2);
  }

  await prisma.character.update({
    where: { id: character.id },
    data: { moodState, moodNote, moodExpiresTurn },
  });

  await prisma.auditLog.create({
    data: {
      actorDiscordUserId: session.discordUserId,
      actionType: "mood_self_reported",
      targetCharacterId: character.id,
      details: { moodState, moodNote },
    },
  });

  revalidatePath("/character");
}

export async function transferResources(formData) {
  const session = await auth();
  if (!session?.discordUserId) redirect("/");

  const character = await prisma.character.findFirst({
    where: { discordUserId: session.discordUserId, status: "ALIVE" },
  });
  if (!character) redirect("/character/new");

  const targetName = formData.get("targetName")?.toString().trim();
  const amount = Number.parseInt(formData.get("amount")?.toString() ?? "", 10);
  if (!targetName || !Number.isFinite(amount) || amount <= 0) return;
  if (amount > character.resources) return;

  const target = await prisma.character.findFirst({
    where: { name: targetName, status: "ALIVE" },
  });
  if (!target || target.id === character.id) return;

  await prisma.$transaction([
    prisma.character.update({
      where: { id: character.id },
      data: { resources: { decrement: amount } },
    }),
    prisma.character.update({
      where: { id: target.id },
      data: { resources: { increment: amount } },
    }),
  ]);

  await prisma.auditLog.create({
    data: {
      actorDiscordUserId: session.discordUserId,
      actionType: "resource_transfer",
      targetCharacterId: target.id,
      details: { fromCharacterId: character.id, toCharacterId: target.id, amount },
    },
  });

  revalidatePath("/character");
}
