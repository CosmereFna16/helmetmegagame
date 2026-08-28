"use server";

import { revalidatePath } from "next/cache";
import { prisma, DRAINED_SLUG, bloodValueForTags, bumpBlood, FEED_PERSON_AMOUNT } from "@lifeweb/db";
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
    where: { id: characterId ?? "", status: "ALIVE" },
    include: { tags: { include: { tag: true } } },
  });
  if (!character) return;

  const alreadyDrained = character.tags.some((ct) => ct.tag.slug === DRAINED_SLUG);
  if (alreadyDrained) return;

  const openTurn = await prisma.turn.findFirst({ where: { status: "OPEN" } });

  const { amount, tier } = bloodValueForTags(character.tags);
  // Atomic read-and-move in one statement; see db/lib/lifeweb.js#bumpBlood for
  // why the old read-then-write shape lost concurrent donations.
  const blood = await bumpBlood(prisma, amount);

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
  revalidatePath("/gm/players", "layout");
  revalidatePath("/character");
}

// No character cost, no Drained tag — a flat top-up.
export async function feedLifewebPerson() {
  const session = await requireGm();

  // bumpBlood upserts the config row itself, so there is nothing to read first.
  const blood = await bumpBlood(prisma, FEED_PERSON_AMOUNT);

  await prisma.auditLog.create({
    data: {
      actorDiscordUserId: session.discordUserId,
      actionType: "gm_fed_lifeweb_person",
      details: { amount: FEED_PERSON_AMOUNT, bloodDelta: blood.delta },
    },
  });

  revalidatePath("/lifeweb");
}
