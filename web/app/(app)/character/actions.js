"use server";

import { revalidatePath } from "next/cache";
import sharp from "sharp";
import { redirect } from "next/navigation";
import { prisma } from "@lifeweb/db";
import { auth } from "@/lib/auth";
import { APPEARANCE_MAX_LENGTH } from "@/lib/constants";
import { syncCharacterNickname, setTurnPingRole, sendDm } from "@/lib/discordGuild";
import { TAG_STORE_CATEGORY_NAMES, unlockedCategoryNames } from "@/lib/tagStore";
import { DESIRE_COOLDOWN_TURNS, desireCompletionPoints } from "@/lib/desire";

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const AVATAR_SIZE = 256;

export async function updateCharacterProfile(formData) {
  const session = await auth();
  if (!session?.discordUserId) redirect("/");

  const character = await prisma.character.findFirst({
    where: { discordUserId: session.discordUserId, status: "ALIVE" },
  });
  if (!character) redirect("/character/new");

  const name = formData.get("name")?.toString().trim();
  const appearance =
    formData.get("appearance")?.toString().trim().slice(0, APPEARANCE_MAX_LENGTH) || null;
  const preferredNickname = formData.get("preferredNickname")?.toString().trim() || null;
  const turnPingOptIn = formData.get("turnPingOptIn") === "on";
  const avatar = formData.get("avatar");

  const data = { appearance, preferredNickname, turnPingOptIn };
  if (name) data.name = name;

  if (avatar && avatar.size > 0) {
    if (avatar.size > MAX_UPLOAD_BYTES) {
      throw new Error("Avatar image must be under 5MB.");
    }
    const buffer = Buffer.from(await avatar.arrayBuffer());
    data.avatarData = await sharp(buffer)
      .resize(AVATAR_SIZE, AVATAR_SIZE, { fit: "cover" })
      .webp({ quality: 85 })
      .toBuffer();
    data.avatarMimeType = "image/webp";
  }

  const updated = await prisma.character.update({ where: { id: character.id }, data });
  await syncCharacterNickname(session.discordUserId, updated.name, updated.preferredNickname).catch(() => {});
  await setTurnPingRole(session.discordUserId, updated.turnPingOptIn).catch(() => {});
  revalidatePath("/character");
}

export async function setMood(formData) {
  const session = await auth();
  if (!session?.discordUserId) redirect("/");

  const character = await prisma.character.findFirst({
    where: { discordUserId: session.discordUserId, status: "ALIVE" },
  });
  if (!character) redirect("/character/new");

  const moodState = formData.get("moodState")?.toString();
  if (!["NEUTRAL", "HAPPY", "UNHAPPY"].includes(moodState)) return;
  const moodNote = formData.get("moodNote")?.toString().trim() || null;

  let moodExpiresTurn = null;
  if (moodState !== "NEUTRAL") {
    const [config, openTurn] = await Promise.all([
      prisma.gameConfig.findUnique({ where: { id: 1 } }),
      prisma.turn.findFirst({ where: { status: "OPEN" } }),
    ]);
    if (openTurn) moodExpiresTurn = openTurn.number + (config?.moodDurationTurns ?? 2);
  }

  await prisma.character.update({
    where: { id: character.id },
    data: { moodState, moodNote, moodExpiresTurn },
  });

  await prisma.auditLog.create({
    data: {
      actorDiscordUserId: session.discordUserId,
      actionType: "mood_self_reported",
      targetCharacterId: character.id,
      details: { moodState, moodNote },
    },
  });

  revalidatePath("/character");
}

export async function transferResources(formData) {
  const session = await auth();
  if (!session?.discordUserId) redirect("/");

  const character = await prisma.character.findFirst({
    where: { discordUserId: session.discordUserId, status: "ALIVE" },
  });
  if (!character) redirect("/character/new");

  const target = formData.get("target")?.toString() ?? "";
  const [targetType, targetId] = target.split(":");
  const amount = Number.parseInt(formData.get("amount")?.toString() ?? "", 10);
  if (!targetType || !targetId || !Number.isFinite(amount) || amount <= 0) return;
  if (amount > character.resources) return;

  if (targetType === "character") {
    if (targetId === character.id) return;
    const targetCharacter = await prisma.character.findFirst({
      where: { id: targetId, status: "ALIVE" },
    });
    if (!targetCharacter) return;

    await prisma.$transaction([
      prisma.character.update({
        where: { id: character.id },
        data: { resources: { decrement: amount } },
      }),
      prisma.character.update({
        where: { id: targetCharacter.id },
        data: { resources: { increment: amount } },
      }),
    ]);

    await prisma.auditLog.create({
      data: {
        actorDiscordUserId: session.discordUserId,
        actionType: "resource_transfer",
        targetCharacterId: targetCharacter.id,
        details: { fromCharacterId: character.id, toCharacterId: targetCharacter.id, amount },
      },
    });
  } else if (targetType === "faction") {
    const faction = await prisma.faction.findUnique({ where: { id: targetId } });
    if (!faction || faction.name === "Unaffiliated") return;

    await prisma.$transaction([
      prisma.character.update({
        where: { id: character.id },
        data: { resources: { decrement: amount } },
      }),
      prisma.faction.update({
        where: { id: faction.id },
        data: { silo: { increment: amount } },
      }),
    ]);

    await prisma.auditLog.create({
      data: {
        actorDiscordUserId: session.discordUserId,
        actionType: "resource_transfer_to_faction_silo",
        details: { fromCharacterId: character.id, factionId: faction.id, amount },
      },
    });
  } else {
    return;
  }

  revalidatePath("/character");
  revalidatePath("/faction");
}

// Reconciles the point-buy store's desired tag selection against the character's
// current POINT_BUY tags. Only tags in unlocked TAG_STORE_CATEGORY_NAMES categories
// are ever touched here — tags granted another way (GM_GRANT, DESIRE_REWARD, EVENT)
// aren't purchasable or sellable through this action and are left untouched, and a
// category gated behind a prerequisite tag (e.g. Bacchus) is re-validated server-side
// so a locked category can't be bought into even if the client is bypassed.
export async function purchaseTags(characterId, desiredTagIds) {
  const session = await auth();
  if (!session?.discordUserId) redirect("/");

  const character = await prisma.character.findFirst({
    where: { id: characterId, discordUserId: session.discordUserId, status: "ALIVE" },
    include: { tags: { include: { tag: true } } },
  });
  if (!character) redirect("/character/new");

  const ownedSlugs = new Set(character.tags.map((ct) => ct.tag.slug).filter(Boolean));
  const unlockedNames = new Set(unlockedCategoryNames(ownedSlugs));

  const allStoreTags = await prisma.tag.findMany({ where: { category: { in: TAG_STORE_CATEGORY_NAMES } } });
  const storeTags = allStoreTags.filter((t) => unlockedNames.has(t.category));
  const storeTagIds = new Set(storeTags.map((t) => t.id));
  const desiredSet = new Set((desiredTagIds ?? []).filter((id) => storeTagIds.has(id)));

  const currentPointBuy = character.tags.filter(
    (ct) => ct.source === "POINT_BUY" && storeTagIds.has(ct.tagId)
  );
  const currentIds = new Set(currentPointBuy.map((ct) => ct.tagId));

  const toAdd = [...desiredSet].filter((id) => !currentIds.has(id));
  const toRemove = currentPointBuy.filter((ct) => !desiredSet.has(ct.tagId));

  const costById = new Map(storeTags.map((t) => [t.id, t.pointCost]));
  const costDelta =
    toAdd.reduce((sum, id) => sum + (costById.get(id) ?? 0), 0) -
    toRemove.reduce((sum, ct) => sum + (costById.get(ct.tagId) ?? 0), 0);
  const newTagPoints = character.tagPoints - costDelta;

  if (newTagPoints < 0) {
    throw new Error("Not enough tag points to leave the store with this selection.");
  }

  await prisma.$transaction([
    ...toRemove.map((ct) => prisma.characterTag.delete({ where: { id: ct.id } })),
    ...toAdd.map((tagId) =>
      prisma.characterTag.create({ data: { characterId: character.id, tagId, source: "POINT_BUY" } })
    ),
    prisma.character.update({ where: { id: character.id }, data: { tagPoints: newTagPoints } }),
  ]);

  revalidatePath("/character");
}

export async function setDesire(characterId, description) {
  const session = await auth();
  if (!session?.discordUserId) redirect("/");

  const character = await prisma.character.findFirst({
    where: { id: characterId, discordUserId: session.discordUserId, status: "ALIVE" },
  });
  if (!character) redirect("/character/new");

  const trimmed = description?.toString().trim();
  if (!trimmed) return;

  const [openTurn, lastDesire] = await Promise.all([
    prisma.turn.findFirst({ where: { status: "OPEN" } }),
    prisma.desire.findFirst({ where: { characterId: character.id }, orderBy: { createdAt: "desc" } }),
  ]);

  if (lastDesire?.status === "ACTIVE") return;
  if (lastDesire?.turnNumber != null && openTurn) {
    const turnsSince = openTurn.number - lastDesire.turnNumber;
    if (turnsSince < DESIRE_COOLDOWN_TURNS) return;
  }

  await prisma.desire.create({
    data: { characterId: character.id, description: trimmed, turnNumber: openTurn?.number ?? null },
  });

  revalidatePath("/character");
}

export async function completeDesire(characterId, desireId) {
  const session = await auth();
  if (!session?.discordUserId) redirect("/");

  const character = await prisma.character.findFirst({
    where: { id: characterId, discordUserId: session.discordUserId, status: "ALIVE" },
    include: { tags: { include: { tag: true } } },
  });
  if (!character) redirect("/character/new");

  const desire = await prisma.desire.findFirst({
    where: { id: desireId, characterId: character.id, status: "ACTIVE" },
  });
  if (!desire) return;

  const ownedSlugs = new Set(character.tags.map((ct) => ct.tag.slug).filter(Boolean));
  const points = desireCompletionPoints(ownedSlugs);

  await prisma.$transaction([
    prisma.desire.update({ where: { id: desire.id }, data: { status: "COMPLETED", completedAt: new Date() } }),
    prisma.character.update({ where: { id: character.id }, data: { tagPoints: { increment: points } } }),
  ]);

  await sendDm(session.discordUserId, `Desire completed: "${desire.description}" (+${points} tag points)`).catch(
    () => {}
  );

  revalidatePath("/character");
}
