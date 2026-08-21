"use server";

import { revalidatePath } from "next/cache";
import { prisma, DRAINED_SLUG, bloodValueForTags, applyBlood, FEED_PERSON_AMOUNT } from "@lifeweb/db";
import { getGmSession } from "@/lib/discordGuild";

async function requireGm() {
  const { session, isGm: gm } = await getGmSession();
  if (!session?.discordUserId) throw new Error("Not authenticated.");
  if (!gm) throw new Error("Not authorized.");
  return session;
}

// The Drained tag auto-expires via its own Tag.defaultDurationTurns
// (docs/tags.yaml) — GM-triggered on behalf of any living character. A
// character already holding Drained cannot be drained again until it expires.
// The amount comes from db/lib/lifeweb.js, the same module the player-facing
// Donate Blood request reads, so the two paths can't grant different numbers.
export async function donateBlood(characterId) {
  const session = await requireGm();
  if (!characterId) return;

  const character = await prisma.character.findFirst({
    where: { id: characterId, status: "ALIVE" },
    include: { tags: { include: { tag: true } } },
  });
  if (!character) return;

  const alreadyDrained = character.tags.some((ct) => ct.tag.slug === DRAINED_SLUG);
  if (alreadyDrained) return;

  const [config, openTurn] = await Promise.all([
    prisma.gameConfig.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } }),
    prisma.turn.findFirst({ where: { status: "OPEN" } }),
  ]);

  const { amount, tier } = bloodValueForTags(character.tags);
  const blood = applyBlood(config.lifewebBlood, amount);
  await prisma.gameConfig.update({ where: { id: 1 }, data: { lifewebBlood: blood.after } });

  if (openTurn) {
    const drainedTag = await prisma.tag.findUnique({ where: { slug: DRAINED_SLUG } });
    if (drainedTag) {
      const expiresTurn =
        drainedTag.defaultDurationTurns != null ? openTurn.number + drainedTag.defaultDurationTurns : null;
      await prisma.characterTag.create({
        data: { characterId: character.id, tagId: drainedTag.id, source: "EVENT", expiresTurn },
      });
    }
  }

  await prisma.auditLog.create({
    data: {
      actorDiscordUserId: session.discordUserId,
      actionType: "gm_donated_lifeweb_blood",
      targetCharacterId: character.id,
      details: { amount, tier, bloodDelta: blood.delta },
    },
  });

  revalidatePath("/lifeweb");
  revalidatePath("/gm/players");
  revalidatePath("/character");
}

// No character cost, no Drained tag — a flat top-up.
export async function feedLifewebPerson() {
  const session = await requireGm();

  const config = await prisma.gameConfig.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } });
  const blood = applyBlood(config.lifewebBlood, FEED_PERSON_AMOUNT);
  await prisma.gameConfig.update({ where: { id: 1 }, data: { lifewebBlood: blood.after } });

  await prisma.auditLog.create({
    data: {
      actorDiscordUserId: session.discordUserId,
      actionType: "gm_fed_lifeweb_person",
      details: { amount: FEED_PERSON_AMOUNT, bloodDelta: blood.delta },
    },
  });

  revalidatePath("/lifeweb");
}
