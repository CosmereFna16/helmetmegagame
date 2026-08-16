"use server";

import { revalidatePath } from "next/cache";
import sharp from "sharp";
import { redirect } from "next/navigation";
import { prisma, NOBILITY_SLUG, ATE_MEAL_SLUG, TIPSY_SLUG } from "@lifeweb/db";
import { auth } from "@/lib/auth";
import { APPEARANCE_MAX_LENGTH } from "@/lib/constants";
import { syncCharacterNickname, setTurnPingRole, sendDm } from "@/lib/discordGuild";
import { TAG_STORE_CATEGORY_NAMES, unlockedCategoryNames } from "@/lib/tagStore";
import { DESIRE_COOLDOWN_TURNS } from "@/lib/desire";

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

// A Fine or Lavish meal exempts the character from next turn's automatic
// resource consumption (see resolveNeeds() in db/index.js) and resets the
// Nobility "turns since last fine meal" tracker. Lavish always triggers a
// temporary Happy; Fine only does for non-Nobility characters — a Nobility
// character eating Fine just meets their standing expectation, clearing an
// existing Unhappy baseline immediately if nothing is currently overlaying it.
export async function ateMeal(characterId, choice) {
  const session = await auth();
  if (!session?.discordUserId) redirect("/");

  if (!["FINE", "LAVISH"].includes(choice)) return;

  const character = await prisma.character.findFirst({
    where: { id: characterId, discordUserId: session.discordUserId, status: "ALIVE" },
    include: { tags: { include: { tag: true } } },
  });
  if (!character) redirect("/character/new");

  const hasNobility = character.tags.some((ct) => ct.tag.slug === NOBILITY_SLUG);

  const [config, openTurn] = await Promise.all([
    prisma.gameConfig.findUnique({ where: { id: 1 } }),
    prisma.turn.findFirst({ where: { status: "OPEN" } }),
  ]);

  const data = { skipNextMealConsumption: true };
  if (openTurn) data.lastFineMealTurn = openTurn.number;

  const triggersHappy = choice === "LAVISH" || (choice === "FINE" && !hasNobility);
  if (triggersHappy) {
    data.moodState = "HAPPY";
    data.moodNote = choice === "LAVISH" ? "A lavish meal" : "A fine meal";
    data.moodExpiresTurn = openTurn ? openTurn.number + (config?.moodDurationTurns ?? 2) : null;
  } else if (hasNobility && character.moodExpiresTurn == null && character.moodState !== "NEUTRAL") {
    data.moodState = "NEUTRAL";
    data.moodNote = null;
  }

  await prisma.character.update({ where: { id: character.id }, data });

  if (openTurn) {
    const ateMealTag = await prisma.tag.findUnique({ where: { slug: ATE_MEAL_SLUG } });
    if (ateMealTag) {
      await prisma.characterTag.upsert({
        where: { characterId_tagId: { characterId: character.id, tagId: ateMealTag.id } },
        create: { characterId: character.id, tagId: ateMealTag.id, source: "EVENT", expiresTurn: openTurn.number },
        update: { expiresTurn: openTurn.number },
      });
    }
  }

  await prisma.auditLog.create({
    data: {
      actorDiscordUserId: session.discordUserId,
      actionType: "ate_meal",
      targetCharacterId: character.id,
      details: { choice },
    },
  });

  revalidatePath("/character");
}

// Alcohol is a stronger, pricier alternative to a meal: it doesn't touch
// hunger at all, but its Tipsy tag shields against Unhappy for its entire
// duration (see resolveNeeds() in db/index.js), not just the Happy portion —
// 2 turns actually Happy, then 2 more just immune to Unhappy on top of that.
export async function drinkAlcohol(characterId) {
  const session = await auth();
  if (!session?.discordUserId) redirect("/");

  const character = await prisma.character.findFirst({
    where: { id: characterId, discordUserId: session.discordUserId, status: "ALIVE" },
  });
  if (!character) redirect("/character/new");

  const [config, openTurn] = await Promise.all([
    prisma.gameConfig.findUnique({ where: { id: 1 } }),
    prisma.turn.findFirst({ where: { status: "OPEN" } }),
  ]);

  const cost = config?.alcoholCost ?? 3;
  if (character.resources < cost) return;

  const data = {
    resources: character.resources - cost,
    moodState: "HAPPY",
    moodNote: "Alcohol",
    moodExpiresTurn: openTurn ? openTurn.number + (config?.moodDurationTurns ?? 2) : null,
  };

  await prisma.character.update({ where: { id: character.id }, data });

  if (openTurn) {
    const tipsyTag = await prisma.tag.findUnique({ where: { slug: TIPSY_SLUG } });
    if (tipsyTag) {
      const expiresTurn = openTurn.number + (config?.alcoholShieldDurationTurns ?? 4);
      await prisma.characterTag.upsert({
        where: { characterId_tagId: { characterId: character.id, tagId: tipsyTag.id } },
        create: { characterId: character.id, tagId: tipsyTag.id, source: "EVENT", expiresTurn },
        update: { expiresTurn },
      });
    }
  }

  await prisma.auditLog.create({
    data: {
      actorDiscordUserId: session.discordUserId,
      actionType: "drank_alcohol",
      targetCharacterId: character.id,
      details: { cost },
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

  // Sequential skill tags (parentTagId chain, e.g. Cooking (Basic) ->
  // Cooking (Skilled)): buying a tier requires already owning its parent
  // (any source, checked against state as of before this purchase — the
  // store UI gates the same way so the two always agree), and supersedes
  // it — the parent is deleted regardless of how it was granted, since
  // owning both tiers of a skill at once doesn't make sense.
  const tagById = new Map([...storeTags, ...character.tags.map((ct) => ct.tag)].map((t) => [t.id, t]));
  const ownedTagIds = new Set(character.tags.map((ct) => ct.tagId));
  for (const id of toAdd) {
    const parentId = tagById.get(id)?.parentTagId;
    if (parentId && !ownedTagIds.has(parentId)) {
      throw new Error("You need the prior tier of this skill before upgrading it.");
    }
  }

  function familyRootId(tagId) {
    let cur = tagById.get(tagId);
    const seen = new Set();
    while (cur?.parentTagId && tagById.has(cur.parentTagId) && !seen.has(cur.id)) {
      seen.add(cur.id);
      cur = tagById.get(cur.parentTagId);
    }
    return cur?.id ?? tagId;
  }

  const desiredFamilyRoots = new Set([...desiredSet].map(familyRootId));
  const supersededNonPointBuy = character.tags.filter(
    (ct) =>
      ct.source !== "POINT_BUY" &&
      !desiredSet.has(ct.tagId) &&
      tagById.has(ct.tagId) &&
      desiredFamilyRoots.has(familyRootId(ct.tagId))
  );

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
    ...supersededNonPointBuy.map((ct) => prisma.characterTag.delete({ where: { id: ct.id } })),
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

  if (lastDesire?.status === "ACTIVE" || lastDesire?.status === "PENDING") return;
  if (lastDesire?.turnNumber != null && openTurn) {
    const turnsSince = openTurn.number - lastDesire.turnNumber;
    if (turnsSince < DESIRE_COOLDOWN_TURNS) return;
  }

  await prisma.desire.create({
    data: { characterId: character.id, description: trimmed, turnNumber: openTurn?.number ?? null },
  });

  revalidatePath("/character");
}

export async function setDefaultEffort(characterId, formData) {
  const session = await auth();
  if (!session?.discordUserId) redirect("/");

  const character = await prisma.character.findFirst({
    where: { id: characterId, discordUserId: session.discordUserId, status: "ALIVE" },
  });
  if (!character) redirect("/character/new");

  const description = formData.get("description")?.toString().trim();
  if (!description) return;

  const shareInSummary = formData.get("shareInSummary") === "on";
  const summaryChannelId = formData.get("summaryChannelId")?.toString().trim() || null;
  const summaryMessage = formData.get("summaryMessage")?.toString().trim() || null;

  await prisma.defaultEffort.upsert({
    where: { characterId: character.id },
    create: {
      characterId: character.id,
      description,
      zoneId: character.zoneId,
      shareInSummary: shareInSummary && !!summaryChannelId,
      summaryChannelId: shareInSummary ? summaryChannelId : null,
      summaryMessage,
      setByCharacterId: character.id,
    },
    update: {
      description,
      zoneId: character.zoneId,
      shareInSummary: shareInSummary && !!summaryChannelId,
      summaryChannelId: shareInSummary ? summaryChannelId : null,
      summaryMessage,
      setByCharacterId: character.id,
    },
  });

  revalidatePath("/character");
}

export async function deleteDefaultEffort(characterId) {
  const session = await auth();
  if (!session?.discordUserId) redirect("/");

  const character = await prisma.character.findFirst({
    where: { id: characterId, discordUserId: session.discordUserId, status: "ALIVE" },
  });
  if (!character) redirect("/character/new");

  await prisma.defaultEffort.deleteMany({ where: { characterId: character.id } });

  revalidatePath("/character");
}

// Marks a desire as ready for GM review — no points are granted here.
// The GM decides whether to approve it and how many points it's worth
// via adjudicateDesire() in gm/actions.js.
export async function submitDesireForReview(characterId, desireId) {
  const session = await auth();
  if (!session?.discordUserId) redirect("/");

  const character = await prisma.character.findFirst({
    where: { id: characterId, discordUserId: session.discordUserId, status: "ALIVE" },
  });
  if (!character) redirect("/character/new");

  const desire = await prisma.desire.findFirst({
    where: { id: desireId, characterId: character.id, status: "ACTIVE" },
  });
  if (!desire) return;

  await prisma.desire.update({ where: { id: desire.id }, data: { status: "PENDING" } });

  await sendDm(session.discordUserId, `Desire submitted for review: "${desire.description}"`).catch(() => {});

  revalidatePath("/character");
  revalidatePath("/gm/turns");
}

// Gives up on the current active desire without submitting it for review.
// Reverts to ACTIVE-free (ABANDONED), still subject to the normal cooldown
// since that's gated on the last desire's turnNumber regardless of status.
export async function cancelDesire(characterId, desireId) {
  const session = await auth();
  if (!session?.discordUserId) redirect("/");

  const character = await prisma.character.findFirst({
    where: { id: characterId, discordUserId: session.discordUserId, status: "ALIVE" },
  });
  if (!character) redirect("/character/new");

  const desire = await prisma.desire.findFirst({
    where: { id: desireId, characterId: character.id, status: "ACTIVE" },
  });
  if (!desire) return;

  await prisma.desire.update({ where: { id: desire.id }, data: { status: "ABANDONED" } });

  await sendDm(session.discordUserId, `Desire cancelled: "${desire.description}"`).catch(() => {});

  revalidatePath("/character");
}

// Anyone signed in — not just the character's own player — can flag that a
// character's tags need GM attention (wrong, missing, outdated). Reviewed
// from the Tags tab of /gm/turns via adjudicateTagChangeRequest() in gm/actions.js.
export async function requestTagChanges(characterId, description) {
  const session = await auth();
  if (!session?.discordUserId) redirect("/");

  const trimmed = description?.toString().trim();
  if (!trimmed) return;

  const character = await prisma.character.findFirst({ where: { id: characterId } });
  if (!character) return;

  await prisma.tagChangeRequest.create({
    data: { characterId: character.id, requestedByDiscordUserId: session.discordUserId, description: trimmed },
  });

  revalidatePath("/character");
  revalidatePath(`/gm/players/${character.id}`);
  revalidatePath("/gm/turns");
}
