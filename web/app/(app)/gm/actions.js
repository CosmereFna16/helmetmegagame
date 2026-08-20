"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@lifeweb/db";
import { getGmSession, sendDm } from "@/lib/discordGuild";

async function requireGm() {
  const { session, isGm: gm } = await getGmSession();
  if (!session?.discordUserId) throw new Error("Not authenticated.");
  if (!gm) throw new Error("Not authorized.");
  return session;
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
