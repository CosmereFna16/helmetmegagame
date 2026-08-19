"use server";

import { redirect } from "next/navigation";
import { prisma } from "@lifeweb/db";
import { auth } from "@/lib/auth";
import { syncCharacterNickname, ensureCharacterRole } from "@/lib/discordGuild";

export async function createCharacter(formData) {
  const session = await auth();
  if (!session?.discordUserId) redirect("/");

  const name = formData.get("name")?.toString().trim();
  if (!name) return;

  const existing = await prisma.character.findFirst({
    where: { discordUserId: session.discordUserId, status: "ALIVE" },
  });
  if (existing) redirect("/character");

  const [config, unaffiliated] = await Promise.all([
    prisma.gameConfig.findUnique({ where: { id: 1 } }),
    prisma.faction.findFirst({ where: { name: "Unaffiliated" } }),
  ]);

  const created = await prisma.character.create({
    data: {
      discordUserId: session.discordUserId,
      name,
      roleTitle: formData.get("roleTitle")?.toString().trim() || null,
      tagPoints: config?.startingTagPoints ?? 0,
      factionId: unaffiliated?.id ?? null,
    },
  });

  await syncCharacterNickname(session.discordUserId, name, null).catch(() => {});
  await ensureCharacterRole(created).catch(() => {});

  redirect("/character");
}
