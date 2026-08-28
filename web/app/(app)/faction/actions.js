"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@lifeweb/db";
import { auth } from "@/lib/auth";
import { getGmSession } from "@/lib/discordGuild";
import { getMyFactionRole } from "@/lib/factionPermissions";

async function requireGm() {
  const { session, isGm: gm } = await getGmSession();
  if (!session?.discordUserId) redirect("/");
  if (!gm) throw new Error("Not authorized.");
  return session;
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
    prisma.character.updateMany({ where: { factionId, isLeader: true }, data: { isLeader: false } }),
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
  // The Factions tab of the Players panel shows the same leaders and counts.
  revalidatePath("/gm/players", "layout");
}

// Grants or revokes Treasurer for a faction member — callable by the
// faction's own Leader (checked via getMyFactionRole, not just GMs) since
// delegating Silo access is meant to be a Leader's call, not a GM errand.
export async function setTreasurer(formData) {
  const session = await auth();
  if (!session?.discordUserId) redirect("/");

  const characterId = formData.get("characterId")?.toString();
  const factionId = formData.get("factionId")?.toString();
  const grant = formData.get("grant") === "true";
  if (!characterId || !factionId) return;

  const { isGm: gm } = await getGmSession();
  const { isLeader } = await getMyFactionRole(session.discordUserId, factionId);
  if (!gm && !isLeader) throw new Error("Not authorized.");

  const character = await prisma.character.findUnique({ where: { id: characterId } });
  if (!character || character.factionId !== factionId) return;

  await prisma.character.update({ where: { id: characterId }, data: { isTreasurer: grant } });

  await prisma.auditLog.create({
    data: {
      actorDiscordUserId: session.discordUserId,
      actionType: grant ? "faction_treasurer_assigned" : "faction_treasurer_revoked",
      targetCharacterId: characterId,
      details: { factionId },
    },
  });

  revalidatePath("/faction");
  // The Factions tab of the Players panel shows the same leaders and counts.
  revalidatePath("/gm/players", "layout");
}

export async function addCharacterToFaction(formData) {
  const session = await requireGm();
  const characterId = formData.get("characterId")?.toString();
  const factionId = formData.get("factionId")?.toString();
  if (!characterId || !factionId) return;

  // Both ids resolved before the write, same as setFactionLeader above.
  // Updating straight from formData threw Prisma's P2025/FK violation on a
  // stale or hand-posted id, and Next redacts a thrown error to a bare digest
  // — so the GM got a broken page instead of a no-op.
  const faction = await prisma.faction.findUnique({ where: { id: factionId } });
  if (!faction) return;

  const character = await prisma.character.findUnique({ where: { id: characterId } });
  if (!character) return;

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
  // The Factions tab of the Players panel shows the same leaders and counts.
  revalidatePath("/gm/players", "layout");
}

export async function removeCharacterFromFaction(formData) {
  const session = await requireGm();
  const characterId = formData.get("characterId")?.toString();
  if (!characterId) return;

  const unaffiliated = await prisma.faction.findFirst({ where: { name: "Unaffiliated" } });
  if (!unaffiliated) return;

  // Resolved before the write for the same reason as addCharacterToFaction.
  const character = await prisma.character.findUnique({ where: { id: characterId } });
  if (!character) return;

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
  // The Factions tab of the Players panel shows the same leaders and counts.
  revalidatePath("/gm/players", "layout");
}
