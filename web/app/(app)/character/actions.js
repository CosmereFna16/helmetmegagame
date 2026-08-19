"use server";

import { revalidatePath } from "next/cache";
import sharp from "sharp";
import { redirect } from "next/navigation";
import { prisma, DRAINED_SLUG } from "@lifeweb/db";
import { auth } from "@/lib/auth";
import { APPEARANCE_MAX_LENGTH } from "@/lib/constants";
import { syncCharacterNickname, setTurnPingRole, ensureCharacterRole } from "@/lib/discordGuild";

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
  const preferredNickname = formData.get("preferredNickname")?.toString().trim() || null;
  const turnPingOptIn = formData.get("turnPingOptIn") === "on";
  const avatar = formData.get("avatar");

  const data = { appearance, preferredNickname, turnPingOptIn };
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

  const updated = await prisma.character.update({ where: { id: character.id }, data });
  await syncCharacterNickname(session.discordUserId, updated.name, updated.preferredNickname).catch(() => {});
  await setTurnPingRole(session.discordUserId, updated.turnPingOptIn).catch(() => {});
  await ensureCharacterRole(updated).catch(() => {});
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

// Volunteering blood for the Lifeweb: always adds a flat amount (capped at
// 100) regardless of the current level, since regular players never see the
// number (see MORTUS_SLUG gating in web/app/(app)/layout.js) — disabling the
// button near full would silently leak that state to them. The cost is the
// Drained tag, not resources; see feedLifewebCorpse() in
// web/app/(app)/lifeweb/actions.js for the other (GM-run) way to feed it.
const LIFEWEB_VOLUNTEER_AMOUNT = 20;

export async function feedLifewebBlood(characterId) {
  const session = await auth();
  if (!session?.discordUserId) redirect("/");

  const character = await prisma.character.findFirst({
    where: { id: characterId, discordUserId: session.discordUserId, status: "ALIVE" },
  });
  if (!character) redirect("/character/new");

  const [config, openTurn] = await Promise.all([
    prisma.gameConfig.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } }),
    prisma.turn.findFirst({ where: { status: "OPEN" } }),
  ]);

  const newBlood = Math.min(100, (config.lifewebBlood ?? 0) + LIFEWEB_VOLUNTEER_AMOUNT);
  await prisma.gameConfig.update({ where: { id: 1 }, data: { lifewebBlood: newBlood } });

  if (openTurn) {
    const drainedTag = await prisma.tag.findUnique({ where: { slug: DRAINED_SLUG } });
    if (drainedTag) {
      const expiresTurn = openTurn.number + (config.lifewebDrainedDurationTurns ?? 4);
      await prisma.characterTag.upsert({
        where: { characterId_tagId: { characterId: character.id, tagId: drainedTag.id } },
        create: { characterId: character.id, tagId: drainedTag.id, source: "EVENT", expiresTurn },
        update: { expiresTurn },
      });
    }
  }

  await prisma.auditLog.create({
    data: {
      actorDiscordUserId: session.discordUserId,
      actionType: "fed_lifeweb_blood",
      targetCharacterId: character.id,
      details: { amount: LIFEWEB_VOLUNTEER_AMOUNT },
    },
  });

  revalidatePath("/character");
  revalidatePath("/lifeweb");
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

export async function setDefaultEffort(characterId, formData) {
  const session = await auth();
  if (!session?.discordUserId) redirect("/");

  const character = await prisma.character.findFirst({
    where: { id: characterId, discordUserId: session.discordUserId, status: "ALIVE" },
  });
  if (!character) redirect("/character/new");

  const description = formData.get("description")?.toString().trim();
  if (!description) return;

  const shareInSummary = formData.get("shareInSummary") === "on";
  const summaryChannelId = formData.get("summaryChannelId")?.toString().trim() || null;
  const summaryMessage = formData.get("summaryMessage")?.toString().trim() || null;

  await prisma.defaultEffort.upsert({
    where: { characterId: character.id },
    create: {
      characterId: character.id,
      description,
      zoneId: character.zoneId,
      shareInSummary: shareInSummary && !!summaryChannelId,
      summaryChannelId: shareInSummary ? summaryChannelId : null,
      summaryMessage,
      setByCharacterId: character.id,
    },
    update: {
      description,
      zoneId: character.zoneId,
      shareInSummary: shareInSummary && !!summaryChannelId,
      summaryChannelId: shareInSummary ? summaryChannelId : null,
      summaryMessage,
      setByCharacterId: character.id,
    },
  });

  revalidatePath("/character");
}

export async function deleteDefaultEffort(characterId) {
  const session = await auth();
  if (!session?.discordUserId) redirect("/");

  const character = await prisma.character.findFirst({
    where: { id: characterId, discordUserId: session.discordUserId, status: "ALIVE" },
  });
  if (!character) redirect("/character/new");

  await prisma.defaultEffort.deleteMany({ where: { characterId: character.id } });

  revalidatePath("/character");
}
