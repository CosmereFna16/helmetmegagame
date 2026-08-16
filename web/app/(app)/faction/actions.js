"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma, LEADER_SLUG, TREASURER_SLUG } from "@lifeweb/db";
import { auth } from "@/lib/auth";
import { getGmSession } from "@/lib/discordGuild";
import { getMyFactionRole, getSiloAccess } from "@/lib/factionPermissions";

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

  const [leaderTag, previousLeaders] = await Promise.all([
    prisma.tag.findUnique({ where: { slug: LEADER_SLUG } }),
    prisma.character.findMany({ where: { factionId, isLeader: true }, select: { id: true } }),
  ]);

  await prisma.$transaction([
    prisma.character.updateMany({ where: { factionId, isLeader: true }, data: { isLeader: false } }),
    prisma.character.update({ where: { id: characterId }, data: { isLeader: true } }),
    ...(leaderTag
      ? [
          prisma.characterTag.deleteMany({
            where: { tagId: leaderTag.id, characterId: { in: previousLeaders.map((c) => c.id) } },
          }),
          prisma.characterTag.upsert({
            where: { characterId_tagId: { characterId, tagId: leaderTag.id } },
            update: {},
            create: { characterId, tagId: leaderTag.id, source: "GM_GRANT" },
          }),
        ]
      : []),
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

// Grants or revokes the Treasurer tag for a faction member — callable by the
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

  const treasurerTag = await prisma.tag.findUnique({ where: { slug: TREASURER_SLUG } });
  if (!treasurerTag) return;

  if (grant) {
    await prisma.characterTag.upsert({
      where: { characterId_tagId: { characterId, tagId: treasurerTag.id } },
      update: {},
      create: { characterId, tagId: treasurerTag.id, source: gm && !isLeader ? "GM_GRANT" : "LEADER_GRANT" },
    });
  } else {
    await prisma.characterTag.deleteMany({ where: { characterId, tagId: treasurerTag.id } });
  }

  await prisma.auditLog.create({
    data: {
      actorDiscordUserId: session.discordUserId,
      actionType: grant ? "faction_treasurer_assigned" : "faction_treasurer_revoked",
      targetCharacterId: characterId,
      details: { factionId },
    },
  });

  revalidatePath("/faction");
}

// Moves resources out of a faction's Silo to a member's personal resources —
// the mechanism by which non-producing roles (courtiers, debutantes, etc.)
// actually get fed, disbursed by whoever holds the Leader or Treasurer tag.
// Every call is logged to SiloTransaction so the faction panel can show a
// plain "who took what, when, how much, to whom" history.
export async function transferFromSilo(formData) {
  const session = await auth();
  if (!session?.discordUserId) redirect("/");

  const factionId = formData.get("factionId")?.toString();
  const toCharacterId = formData.get("toCharacterId")?.toString();
  const amount = Number.parseInt(formData.get("amount")?.toString() ?? "", 10);
  const note = formData.get("note")?.toString().trim() || null;
  if (!factionId || !toCharacterId || !Number.isFinite(amount) || amount <= 0) return;

  const { isGm: gm } = await getGmSession();
  // Ancestor-aware: also covers a parent faction's Leader/Treasurer acting
  // on a subject faction's Silo, not just the same-faction case.
  const { character: myCharacter, canManageSilo } = await getSiloAccess(session.discordUserId, factionId);
  if (!gm && !canManageSilo) throw new Error("Not authorized.");
  // Only attribute the transaction to the actor's character when they
  // actually hold real standing here (own faction or an ancestor of it) — a
  // GM acting on a faction with no such standing shouldn't log an unrelated
  // character's name.
  const actorCharacter = canManageSilo ? myCharacter : null;

  const [faction, toCharacter, openTurn] = await Promise.all([
    prisma.faction.findUnique({ where: { id: factionId } }),
    prisma.character.findUnique({ where: { id: toCharacterId } }),
    prisma.turn.findFirst({ where: { status: "OPEN" } }),
  ]);
  if (!faction || faction.name === "Unaffiliated") return;
  if (!toCharacter || toCharacter.factionId !== factionId) return;
  if (amount > faction.silo) return;

  await prisma.$transaction([
    prisma.faction.update({ where: { id: factionId }, data: { silo: { decrement: amount } } }),
    prisma.character.update({ where: { id: toCharacterId }, data: { resources: { increment: amount } } }),
    prisma.siloTransaction.create({
      data: {
        factionId,
        amount: -amount,
        actorDiscordUserId: session.discordUserId,
        actorCharacterId: actorCharacter?.id ?? null,
        actorName: actorCharacter?.name ?? "GM",
        toCharacterId,
        toName: toCharacter.name,
        turnNumber: openTurn?.number ?? null,
        turnPhase: openTurn?.phase ?? null,
        note,
      },
    }),
  ]);

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
