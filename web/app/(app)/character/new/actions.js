"use server";

import { redirect } from "next/navigation";
import { prisma } from "@lifeweb/db";
import { auth } from "@/lib/auth";

export async function createCharacter(formData) {
  const session = await auth();
  if (!session?.discordUserId) redirect("/");

  const name = formData.get("name")?.toString().trim();
  if (!name) return;

  const existing = await prisma.character.findFirst({
    where: { discordUserId: session.discordUserId, status: "ALIVE" },
  });
  if (existing) redirect("/character");

  const config = await prisma.gameConfig.findUnique({ where: { id: 1 } });

  await prisma.character.create({
    data: {
      discordUserId: session.discordUserId,
      name,
      roleTitle: formData.get("roleTitle")?.toString().trim() || null,
      tagPoints: config?.startingTagPoints ?? 0,
    },
  });

  redirect("/character");
}
