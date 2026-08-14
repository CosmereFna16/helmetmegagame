"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@lifeweb/db";
import { auth } from "@/lib/auth";
import { getGuildMember, isGm } from "@/lib/discordGuild";

async function requireGm() {
  const session = await auth();
  if (!session?.discordUserId) throw new Error("Not authenticated.");
  const member = await getGuildMember(session.discordUserId);
  if (!isGm(member)) throw new Error("Not authorized.");
}

async function getConfig() {
  return prisma.gameConfig.upsert({
    where: { id: 1 },
    update: {},
    create: { id: 1 },
  });
}

export async function addTupperChannel(formData) {
  await requireGm();
  const channelId = formData.get("channelId")?.toString().trim();
  if (!channelId) return;

  const config = await getConfig();
  if (!config.tupperChannelIds.includes(channelId)) {
    await prisma.gameConfig.update({
      where: { id: 1 },
      data: { tupperChannelIds: { push: channelId } },
    });
  }
  revalidatePath("/gm");
}

export async function removeTupperChannel(formData) {
  await requireGm();
  const channelId = formData.get("channelId")?.toString().trim();
  if (!channelId) return;

  const config = await getConfig();
  await prisma.gameConfig.update({
    where: { id: 1 },
    data: { tupperChannelIds: config.tupperChannelIds.filter((id) => id !== channelId) },
  });
  revalidatePath("/gm");
}
