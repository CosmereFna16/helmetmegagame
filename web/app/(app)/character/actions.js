"use server";

import { revalidatePath } from "next/cache";
import sharp from "sharp";
import { redirect } from "next/navigation";
import { prisma } from "@lifeweb/db";
import { auth } from "@/lib/auth";
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

  const target = formData.get("target")?.toString() ?? "";
  const [targetType, targetId] = target.split(":");
  const amount = Number.parseInt(formData.get("amount")?.toString() ?? "", 10);
  if (!targetType || !targetId || !Number.isFinite(amount) || amount <= 0) return;
  if (amount > character.resources) return;

  if (targetType === "character") {
    if (targetId === character.id) return;
    const targetCharacter = await prisma.character.findFirst({
      where: { id: targetId, status: "ALIVE" },
    });
    if (!targetCharacter) return;

    await prisma.$transaction([
      prisma.character.update({
        where: { id: character.id },
        data: { resources: { decrement: amount } },
      }),
      prisma.character.update({
        where: { id: targetCharacter.id },
        data: { resources: { increment: amount } },
      }),
    ]);

    await prisma.auditLog.create({
      data: {
        actorDiscordUserId: session.discordUserId,
        actionType: "resource_transfer",
        targetCharacterId: targetCharacter.id,
        details: { fromCharacterId: character.id, toCharacterId: targetCharacter.id, amount },
      },
    });
  } else if (targetType === "faction") {
    const faction = await prisma.faction.findUnique({ where: { id: targetId } });
    if (!faction || faction.name === "Unaffiliated") return;

    await prisma.$transaction([
      prisma.character.update({
        where: { id: character.id },
        data: { resources: { decrement: amount } },
      }),
      prisma.faction.update({
        where: { id: faction.id },
        data: { silo: { increment: amount } },
      }),
    ]);

    await prisma.auditLog.create({
      data: {
        actorDiscordUserId: session.discordUserId,
        actionType: "resource_transfer_to_faction_silo",
        details: { fromCharacterId: character.id, factionId: faction.id, amount },
      },
    });
  } else {
    return;
  }

  revalidatePath("/character");
  revalidatePath("/faction");
}
