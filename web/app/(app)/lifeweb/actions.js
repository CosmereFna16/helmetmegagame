"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@lifeweb/db";
import { getGmSession } from "@/lib/discordGuild";

async function requireGm() {
  const { session, isGm: gm } = await getGmSession();
  if (!session?.discordUserId) throw new Error("Not authenticated.");
  if (!gm) throw new Error("Not authorized.");
  return session;
}

// Feeding a body to the Lifeweb instead of burying it — the other of the
// Mortii's two sacred jobs (see docs/ROLES.md). A deliberate GM call rather
// than something that happens automatically on death.
export async function feedLifewebCorpse(formData) {
  const session = await requireGm();

  const characterId = formData.get("characterId")?.toString();
  if (!characterId) return;

  const character = await prisma.character.findFirst({ where: { id: characterId, status: "DEAD" } });
  if (!character) return;

  const config = await prisma.gameConfig.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } });
  const newBlood = Math.min(100, (config.lifewebBlood ?? 0) + 100);
  await prisma.gameConfig.update({ where: { id: 1 }, data: { lifewebBlood: newBlood } });

  await prisma.auditLog.create({
    data: {
      actorDiscordUserId: session.discordUserId,
      actionType: "fed_lifeweb_corpse",
      targetCharacterId: character.id,
      details: { amount: 100, characterName: character.name },
    },
  });

  revalidatePath("/lifeweb");
  revalidatePath("/gm/players");
}
