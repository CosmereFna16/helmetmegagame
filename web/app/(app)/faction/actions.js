"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@lifeweb/db";
import { getGmSession } from "@/lib/discordGuild";

async function requireGm() {
  const { session, isGm: gm } = await getGmSession();
  if (!session?.discordUserId) redirect("/");
  if (!gm) throw new Error("Not authorized.");
  return session;
}

export async function createFaction(formData) {
  const session = await requireGm();
  const name = formData.get("name")?.toString().trim();
  if (!name) return;

  const faction = await prisma.faction.create({
    data: { name, discordRoleId: `manual:${randomUUID()}` },
  });

  await prisma.auditLog.create({
    data: {
      actorDiscordUserId: session.discordUserId,
      actionType: "faction_created",
      details: { factionId: faction.id, name },
    },
  });

  revalidatePath("/faction");
}

export async function setFactionLeader(formData) {
  const session = await requireGm();
  const characterId = formData.get("characterId")?.toString();
  const factionId = formData.get("factionId")?.toString();
  if (!characterId || !factionId) return;

  const faction = await prisma.faction.findUnique({ where: { id: factionId } });
  if (!faction || faction.name === "Unaffiliated") return;

  const character = await prisma.character.findUnique({ where: { id: characterId } });
  if (!character || character.factionId !== factionId) return;

  await prisma.$transaction([
    prisma.character.updateMany({
      where: { factionId, isLeader: true },
      data: { isLeader: false },
    }),
    prisma.character.update({ where: { id: characterId }, data: { isLeader: true } }),
  ]);

  await prisma.auditLog.create({
    data: {
      actorDiscordUserId: session.discordUserId,
      actionType: "faction_leader_set",
      targetCharacterId: characterId,
      details: { factionId },
    },
  });

  revalidatePath("/faction");
}

export async function addCharacterToFaction(formData) {
  const session = await requireGm();
  const characterId = formData.get("characterId")?.toString();
  const factionId = formData.get("factionId")?.toString();
  if (!characterId || !factionId) return;

  await prisma.character.update({
    where: { id: characterId },
    data: { factionId, isLeader: false },
  });

  await prisma.auditLog.create({
    data: {
      actorDiscordUserId: session.discordUserId,
      actionType: "faction_member_added",
      targetCharacterId: characterId,
      details: { factionId },
    },
  });

  revalidatePath("/faction");
}

export async function removeCharacterFromFaction(formData) {
  const session = await requireGm();
  const characterId = formData.get("characterId")?.toString();
  if (!characterId) return;

  const unaffiliated = await prisma.faction.findFirst({ where: { name: "Unaffiliated" } });
  if (!unaffiliated) return;

  await prisma.character.update({
    where: { id: characterId },
    data: { factionId: unaffiliated.id, isLeader: false },
  });

  await prisma.auditLog.create({
    data: {
      actorDiscordUserId: session.discordUserId,
      actionType: "faction_member_removed",
      targetCharacterId: characterId,
    },
  });

  revalidatePath("/faction");
}
