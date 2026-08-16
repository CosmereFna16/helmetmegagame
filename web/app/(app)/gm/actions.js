"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@lifeweb/db";
import {
  getGmSession,
  postMessage,
  sendDm,
  listGuildChannels,
  isSummaryChannel,
  getMessageStarCount,
} from "@/lib/discordGuild";
import { finalDesirePoints, DESIRE_MIN_POINTS } from "@/lib/desire";

async function requireGm() {
  const { session, isGm: gm } = await getGmSession();
  if (!session?.discordUserId) throw new Error("Not authenticated.");
  if (!gm) throw new Error("Not authorized.");
  return session;
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

export async function adjudicateDesire(formData) {
  const session = await requireGm();

  const desireId = formData.get("desireId")?.toString();
  if (!desireId) return;
  const approved = formData.get("decision") === "approve";
  const basePoints = Number.parseInt(formData.get("points")?.toString() ?? "", 10);
  const message = formData.get("message")?.toString().trim() || null;
  const gmNotes = formData.get("gmNotes")?.toString().trim() || null;

  const desire = await prisma.desire.findUnique({
    where: { id: desireId },
    include: { character: { include: { tags: { include: { tag: true } } } } },
  });
  if (!desire || desire.status !== "PENDING") return;

  if (approved) {
    const ownedSlugs = new Set(desire.character.tags.map((ct) => ct.tag.slug).filter(Boolean));
    const points = finalDesirePoints(Number.isFinite(basePoints) ? basePoints : DESIRE_MIN_POINTS, ownedSlugs);

    await prisma.$transaction([
      prisma.desire.update({
        where: { id: desire.id },
        data: { status: "COMPLETED", completedAt: new Date(), pointsAwarded: points, resultMessage: message, gmNotes },
      }),
      prisma.character.update({ where: { id: desire.characterId }, data: { tagPoints: { increment: points } } }),
    ]);

    await sendDm(
      desire.character.discordUserId,
      `Desire approved: "${desire.description}" (+${points} tag points)${message ? ` — ${message}` : ""}`,
    ).catch(() => {});
  } else {
    await prisma.desire.update({
      where: { id: desire.id },
      data: { status: "ACTIVE", resultMessage: message, gmNotes },
    });

    await sendDm(
      desire.character.discordUserId,
      `Desire not approved: "${desire.description}"${message ? ` — ${message}` : ""}`,
    ).catch(() => {});
  }

  await prisma.auditLog.create({
    data: {
      actorDiscordUserId: session.discordUserId,
      actionType: "desire_adjudicated",
      targetCharacterId: desire.characterId,
      details: { desireId, approved },
    },
  });

  revalidatePath("/gm/turns");
  revalidatePath("/character");
  revalidatePath("/gm/players");
}

export async function adjudicateTagChangeRequest(formData) {
  const session = await requireGm();

  const requestId = formData.get("requestId")?.toString();
  if (!requestId) return;
  const message = formData.get("message")?.toString().trim() || null;
  const gmNotes = formData.get("gmNotes")?.toString().trim() || null;

  const request = await prisma.tagChangeRequest.findUnique({
    where: { id: requestId },
    include: { character: true },
  });
  if (!request || request.status !== "PENDING") return;

  await prisma.tagChangeRequest.update({
    where: { id: request.id },
    data: { status: "RESOLVED", resolvedAt: new Date(), resultMessage: message, gmNotes },
  });

  if (message) {
    await sendDm(request.character.discordUserId, `Tag change request resolved: "${request.description}" — ${message}`).catch(() => {});
  }

  await prisma.auditLog.create({
    data: {
      actorDiscordUserId: session.discordUserId,
      actionType: "tag_change_request_resolved",
      targetCharacterId: request.characterId,
      details: { requestId },
    },
  });

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

// Re-fetches each listed message straight from Discord to get its true
// current star count — the bot's on-add update can't see stars being
// removed, so this is how a GM reconciles that. Scoped to whatever's on the
// current archive page/filters (passed in as hidden "id" fields) rather than
// the whole archive, to keep one click cheap.
export async function refreshArchiveStars(formData) {
  await requireGm();

  const ids = formData.getAll("id").map(String).filter(Boolean);
  if (ids.length === 0) return;

  const entries = await prisma.archivedMessage.findMany({
    where: { id: { in: ids } },
    select: { id: true, discordChannelId: true, discordMessageId: true },
  });

  await Promise.all(
    entries.map(async (entry) => {
      const count = await getMessageStarCount(entry.discordChannelId, entry.discordMessageId).catch(() => null);
      if (count == null) return;
      await prisma.archivedMessage.update({ where: { id: entry.id }, data: { starCount: count } });
    }),
  );

  revalidatePath("/gm/archive");
}
