"use server";

import { revalidatePath } from "next/cache";
import { prisma, advanceTurn as advanceTurnInDb } from "@lifeweb/db";
import { auth } from "@/lib/auth";
import { isSuperadmin } from "@/lib/superadmin";
import { postMessage, listGuildChannels, isSummaryChannel } from "@/lib/discordGuild";

async function requireSuperadmin() {
  const session = await auth();
  if (!session?.discordUserId || !isSuperadmin(session.discordUserId)) {
    throw new Error("Not authorized.");
  }
  return session;
}

function str(formData, key) {
  const v = formData.get(key);
  return v == null ? "" : v.toString();
}

function intOrNull(formData, key) {
  const v = str(formData, key).trim();
  if (v === "") return null;
  const n = Number.parseInt(v, 10);
  return Number.isNaN(n) ? null : n;
}

function intOrZero(formData, key) {
  return intOrNull(formData, key) ?? 0;
}

export async function updateGameConfig(formData) {
  await requireSuperadmin();

  await prisma.gameConfig.upsert({
    where: { id: 1 },
    create: { id: 1 },
    update: {
      startingTagPoints: intOrZero(formData, "startingTagPoints"),
      resourceConsumptionPerTurn: intOrZero(formData, "resourceConsumptionPerTurn"),
      moodDurationTurns: intOrZero(formData, "moodDurationTurns"),
      hungerMovePenalty: intOrZero(formData, "hungerMovePenalty"),
      moodMovePenalty: intOrZero(formData, "moodMovePenalty"),
      moodMoveBonus: intOrZero(formData, "moodMoveBonus"),
    },
  });

  revalidatePath("/gm/dev");
}

// Directly overrides the current turn's day/phase (creating one if none is
// open) rather than routing through Needs resolution — a raw superadmin
// correction, not a normal turn advance.
export async function updateCurrentTurn(formData) {
  await requireSuperadmin();

  const day = intOrNull(formData, "day");
  const phase = str(formData, "phase") || "DAWN";
  if (day == null || day < 1) return;

  const number = (day - 1) * 2 + (phase === "DAWN" ? 1 : 2);

  const openTurnRecord = await prisma.turn.findFirst({ where: { status: "OPEN" } });
  if (openTurnRecord) {
    await prisma.turn.update({ where: { id: openTurnRecord.id }, data: { number, phase } });
  } else {
    await prisma.turn.create({ data: { number, phase, status: "OPEN", gameDate: new Date() } });
  }

  revalidatePath("/gm/dev");
  revalidatePath("/", "layout");
}

export async function forceAdvanceTurn() {
  const session = await requireSuperadmin();

  const { previousTurn, newTurn } = await advanceTurnInDb();

  await prisma.auditLog.create({
    data: {
      actorDiscordUserId: session.discordUserId,
      actionType: "superadmin_turn_forced",
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

  revalidatePath("/gm/dev");
  revalidatePath("/", "layout");
}

export async function updateCharacterRaw(formData) {
  await requireSuperadmin();

  const characterId = str(formData, "characterId");
  if (!characterId) return;

  const factionId = str(formData, "factionId").trim() || null;
  const zoneId = str(formData, "zoneId").trim() || null;
  const moodNote = str(formData, "moodNote").trim() || null;
  const appearance = str(formData, "appearance").trim() || null;
  const roleTitle = str(formData, "roleTitle").trim() || null;

  await prisma.character.update({
    where: { id: characterId },
    data: {
      name: str(formData, "name").trim(),
      roleTitle,
      factionId,
      zoneId,
      isLeader: formData.get("isLeader") === "on",
      status: str(formData, "status"),
      resources: intOrZero(formData, "resources"),
      tagPoints: intOrZero(formData, "tagPoints"),
      moodState: str(formData, "moodState"),
      moodExpiresTurn: intOrNull(formData, "moodExpiresTurn"),
      moodNote,
      isHungry: formData.get("isHungry") === "on",
      appearance,
    },
  });

  await prisma.auditLog.create({
    data: {
      actorDiscordUserId: (await auth()).discordUserId,
      actionType: "superadmin_character_edit",
      targetCharacterId: characterId,
    },
  });

  revalidatePath("/gm/dev/characters");
  revalidatePath(`/gm/dev/characters/${characterId}`);
  revalidatePath("/gm/players");
  revalidatePath("/character");
}

export async function updateFaction(formData) {
  await requireSuperadmin();

  const factionId = str(formData, "factionId");
  if (!factionId) return;

  await prisma.faction.update({
    where: { id: factionId },
    data: {
      name: str(formData, "name").trim(),
      discordRoleId: str(formData, "discordRoleId").trim(),
      silo: intOrZero(formData, "silo"),
    },
  });

  revalidatePath("/gm/dev/factions");
  revalidatePath("/faction");
}

export async function updateZone(formData) {
  await requireSuperadmin();

  const zoneId = str(formData, "zoneId");
  if (!zoneId) return;

  const discordChannelIds = str(formData, "discordChannelIds")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  await prisma.zone.update({
    where: { id: zoneId },
    data: {
      name: str(formData, "name").trim(),
      discordChannelIds,
    },
  });

  revalidatePath("/gm/dev/zones");
}
