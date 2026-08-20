"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@lifeweb/db";
import { moodTagSlug, moodLabel, MOOD_SLUGS } from "@lifeweb/db/lib/mood";
import { auth } from "@/lib/auth";
import { getOpenTurn } from "@/lib/turn";
import { createRequest, logRequest, requireReason } from "@/lib/requests";
import { TRANSFERABLE_CATEGORIES } from "@/lib/tagRequests";
import { syncCharacterNarrowcastAccess } from "@/lib/discordGuild";

// Every player-initiated change that is applied immediately and reviewed
// afterwards. Each action: authenticate, re-validate everything the client
// sent (a server action is a public endpoint), then apply the effect and
// write the Request + AuditLog rows in ONE transaction, so a request can
// never exist without its effect or vice versa.

const DESIRE_MIN_POINTS = 1;
const DESIRE_MAX_POINTS = 5;

async function requireCharacter() {
  const session = await auth();
  if (!session?.discordUserId) redirect("/");
  const character = await prisma.character.findFirst({
    where: { discordUserId: session.discordUserId, status: "ALIVE" },
    include: { tags: { include: { tag: true } } },
  });
  if (!character) redirect("/character");
  return { session, character };
}

function revalidateAll() {
  revalidatePath("/character");
  revalidatePath("/faction");
  revalidatePath("/gm/turns");
  revalidatePath("/gm/audit");
}

function parseCount(raw, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const n = Number.parseInt(raw ?? "", 10);
  if (!Number.isFinite(n) || n < min || n > max) return null;
  return n;
}

// --- Mood -------------------------------------------------------------

export async function setMoodRequest({ mood, reason: rawReason }) {
  const { session, character } = await requireCharacter();
  const reason = requireReason(rawReason);
  if (!["NEUTRAL", "HAPPY", "UNHAPPY"].includes(mood)) throw new Error("Unknown mood.");

  const openTurn = await getOpenTurn();
  const moodTags = await prisma.tag.findMany({
    where: { slug: { in: [MOOD_SLUGS.HAPPY, MOOD_SLUGS.UNHAPPY] } },
  });
  const moodTagIds = moodTags.map((t) => t.id);

  // Snapshot whatever mood is being displaced, so Undo can put it back with
  // its original remaining duration rather than a fresh 2 turns.
  const existing = character.tags.find((ct) => moodTagIds.includes(ct.tagId));
  const previous = existing
    ? { tagId: existing.tagId, source: existing.source, expiresTurn: existing.expiresTurn }
    : null;

  const slug = moodTagSlug(mood);
  const target = slug ? moodTags.find((t) => t.slug === slug) : null;
  if (slug && !target) throw new Error("Mood tags are missing — run npm run db:sync-tags.");

  const expiresTurn =
    target && openTurn && target.defaultDurationTurns != null
      ? openTurn.number + target.defaultDurationTurns
      : null;

  await prisma.$transaction(async (tx) => {
    // Neutral is the absence of both tags, so every path clears first.
    await tx.characterTag.deleteMany({ where: { characterId: character.id, tagId: { in: moodTagIds } } });
    if (target) {
      await tx.characterTag.create({
        data: { characterId: character.id, tagId: target.id, source: "EVENT", expiresTurn },
      });
    }

    await createRequest(tx, {
      characterId: character.id,
      turnId: openTurn?.id ?? null,
      type: "SET_MOOD",
      reason,
      payload: { mood },
      effect: { mood, appliedTagId: target?.id ?? null, expiresTurn, previous },
    });
    await logRequest(tx, {
      actorDiscordUserId: session.discordUserId,
      actionType: "request_set_mood",
      targetCharacterId: character.id,
      reason,
      details: { mood },
    });
  });

  revalidateAll();
  return { ok: true, mood: moodLabel(mood) };
}

// --- Resources --------------------------------------------------------

// "character:<id>" / "faction:<id>" on both ends. Per the design call, the
// SOURCE may be any faction silo or any living player — a player can pull
// resources to themselves and justify it in the reason, and a GM undoes it if
// that was a lie. That's the whole bet of the Requests system.
async function resolveParty(key) {
  const [kind, id] = (key ?? "").split(":");
  if (kind === "character") {
    const c = await prisma.character.findFirst({ where: { id, status: "ALIVE" }, select: { id: true, name: true, resources: true } });
    return c ? { kind, id: c.id, name: c.name, balance: c.resources } : null;
  }
  if (kind === "faction") {
    const f = await prisma.faction.findUnique({ where: { id }, select: { id: true, name: true, silo: true } });
    if (!f || f.name === "Unaffiliated") return null;
    return { kind, id: f.id, name: f.name, balance: f.silo };
  }
  return null;
}

export async function transferResourcesRequest({ fromKey, toKey, amount: rawAmount, reason: rawReason }) {
  const { session, character } = await requireCharacter();
  const reason = requireReason(rawReason);

  const amount = parseCount(rawAmount, { min: 1 });
  if (amount == null) throw new Error("Amount must be a positive whole number.");

  const [from, to] = await Promise.all([resolveParty(fromKey), resolveParty(toKey)]);
  if (!from) throw new Error("Unknown source.");
  if (!to) throw new Error("Unknown recipient.");
  if (from.kind === to.kind && from.id === to.id) throw new Error("Source and recipient are the same.");
  if (amount > from.balance) throw new Error(`${from.name} only has ${from.balance} ⬢.`);

  const openTurn = await getOpenTurn();
  const ledger = {
    actorDiscordUserId: session.discordUserId,
    actorCharacterId: character.id,
    actorName: character.name,
    turnNumber: openTurn?.number ?? null,
    turnPhase: openTurn?.phase ?? null,
    note: reason,
  };

  await prisma.$transaction(async (tx) => {
    for (const [party, delta] of [
      [from, -amount],
      [to, amount],
    ]) {
      if (party.kind === "character") {
        await tx.character.update({
          where: { id: party.id },
          data: { resources: delta < 0 ? { decrement: -delta } : { increment: delta } },
        });
      } else {
        await tx.faction.update({
          where: { id: party.id },
          data: { silo: delta < 0 ? { decrement: -delta } : { increment: delta } },
        });
        // Both directions get a SiloTransaction now — deposits into a silo
        // previously left no ledger entry at all.
        await tx.siloTransaction.create({
          data: {
            factionId: party.id,
            amount: delta,
            toCharacterId: to.kind === "character" ? to.id : null,
            toName: to.name,
            ...ledger,
          },
        });
      }
    }

    const effect = {
      amount,
      from: { kind: from.kind, id: from.id, name: from.name },
      to: { kind: to.kind, id: to.id, name: to.name },
    };
    await createRequest(tx, {
      characterId: character.id,
      turnId: openTurn?.id ?? null,
      type: "TRANSFER_RESOURCES",
      reason,
      payload: { fromKey, toKey, amount },
      effect,
    });
    await logRequest(tx, {
      actorDiscordUserId: session.discordUserId,
      actionType: "request_transfer_resources",
      targetCharacterId: to.kind === "character" ? to.id : character.id,
      reason,
      details: effect,
    });
  });

  revalidateAll();
  return { ok: true };
}

// --- Tags -------------------------------------------------------------

export async function addTagRequest({ tagId, resourcesSpent: rawSpend, reason: rawReason }) {
  const { session, character } = await requireCharacter();
  const reason = requireReason(rawReason);

  const resourcesSpent = parseCount(rawSpend, { min: 0 }) ?? 0;
  if (resourcesSpent > character.resources) throw new Error("You don't have that many ⬢.");

  const tag = await prisma.tag.findUnique({ where: { id: tagId } });
  if (!tag) throw new Error("Unknown tag.");
  // Mirrors addableTags() in web/lib/tagRequests.js — re-checked here because
  // the client's filtered list is only advisory.
  if (!tag.purchasable && !tag.craftable) throw new Error("That tag can't be added this way.");
  if (character.tags.some((ct) => ct.tagId === tag.id)) throw new Error("You already have that tag.");

  const openTurn = await getOpenTurn();

  await prisma.$transaction(async (tx) => {
    await tx.characterTag.create({
      data: { characterId: character.id, tagId: tag.id, source: "EVENT", expiresTurn: null },
    });
    if (resourcesSpent) {
      await tx.character.update({
        where: { id: character.id },
        data: { resources: { decrement: resourcesSpent } },
      });
    }
    await createRequest(tx, {
      characterId: character.id,
      turnId: openTurn?.id ?? null,
      type: "ADD_TAG",
      reason,
      payload: { tagId: tag.id, resourcesSpent },
      effect: { tagId: tag.id, tagName: tag.name, resourcesSpent },
    });
    await logRequest(tx, {
      actorDiscordUserId: session.discordUserId,
      actionType: "request_add_tag",
      targetCharacterId: character.id,
      reason,
      details: { tagId: tag.id, tagName: tag.name, resourcesSpent },
    });
  });

  // Tags gate #radio access, so a grant can change narrowcast visibility.
  await syncCharacterNarrowcastAccess(character.id).catch(() => {});
  revalidateAll();
  return { ok: true };
}

export async function removeTagRequest({ tagId, resourcesSpent: rawSpend, reason: rawReason }) {
  const { session, character } = await requireCharacter();
  const reason = requireReason(rawReason);

  const resourcesSpent = parseCount(rawSpend, { min: 0 }) ?? 0;
  if (resourcesSpent > character.resources) throw new Error("You don't have that many ⬢.");

  const held = character.tags.find((ct) => ct.tagId === tagId);
  if (!held) throw new Error("You don't have that tag.");
  if (!held.tag.removable) throw new Error("That tag can't be removed this way.");

  const openTurn = await getOpenTurn();
  // Snapshot before deleting — Undo restores the original source and expiry,
  // not a fresh grant.
  const restore = { tagId: held.tagId, source: held.source, expiresTurn: held.expiresTurn };

  await prisma.$transaction(async (tx) => {
    await tx.characterTag.deleteMany({ where: { characterId: character.id, tagId } });
    if (resourcesSpent) {
      await tx.character.update({
        where: { id: character.id },
        data: { resources: { decrement: resourcesSpent } },
      });
    }
    await createRequest(tx, {
      characterId: character.id,
      turnId: openTurn?.id ?? null,
      type: "REMOVE_TAG",
      reason,
      payload: { tagId, resourcesSpent },
      effect: { tagId, tagName: held.tag.name, resourcesSpent, restore },
    });
    await logRequest(tx, {
      actorDiscordUserId: session.discordUserId,
      actionType: "request_remove_tag",
      targetCharacterId: character.id,
      reason,
      details: { tagId, tagName: held.tag.name, resourcesSpent },
    });
  });

  await syncCharacterNarrowcastAccess(character.id).catch(() => {});
  revalidateAll();
  return { ok: true };
}

// Send-only by design: there is no "request a tag from someone", because
// browsing another player's inventory to pick something is the abuse the
// one-way flow prevents.
export async function transferTagRequest({ tagId, toCharacterId, reason: rawReason }) {
  const { session, character } = await requireCharacter();
  const reason = requireReason(rawReason);

  const held = character.tags.find((ct) => ct.tagId === tagId);
  if (!held) throw new Error("You don't have that tag.");
  if (!TRANSFERABLE_CATEGORIES.includes(held.tag.category)) {
    throw new Error("Only Items and Assets can be handed over.");
  }
  if (toCharacterId === character.id) throw new Error("That's you.");

  const recipient = await prisma.character.findFirst({
    where: { id: toCharacterId, status: "ALIVE" },
    select: { id: true, name: true },
  });
  if (!recipient) throw new Error("Unknown recipient.");

  const openTurn = await getOpenTurn();
  const restore = { source: held.source, expiresTurn: held.expiresTurn };

  await prisma.$transaction(async (tx) => {
    await tx.characterTag.deleteMany({ where: { characterId: character.id, tagId } });
    await tx.characterTag.upsert({
      where: { characterId_tagId: { characterId: recipient.id, tagId } },
      create: { characterId: recipient.id, tagId, source: "EVENT", expiresTurn: held.expiresTurn },
      update: { expiresTurn: held.expiresTurn },
    });
    await createRequest(tx, {
      characterId: character.id,
      turnId: openTurn?.id ?? null,
      type: "TRANSFER_TAG",
      reason,
      payload: { tagId, toCharacterId: recipient.id },
      effect: {
        tagId,
        tagName: held.tag.name,
        fromCharacterId: character.id,
        toCharacterId: recipient.id,
        toName: recipient.name,
        restore,
      },
    });
    await logRequest(tx, {
      actorDiscordUserId: session.discordUserId,
      actionType: "request_transfer_tag",
      targetCharacterId: recipient.id,
      reason,
      details: { tagId, tagName: held.tag.name, toName: recipient.name },
    });
  });

  await Promise.all([
    syncCharacterNarrowcastAccess(character.id).catch(() => {}),
    syncCharacterNarrowcastAccess(recipient.id).catch(() => {}),
  ]);
  revalidateAll();
  return { ok: true };
}

// --- Desires ----------------------------------------------------------

// Setting and cancelling are NOT requests — nothing has been granted yet, so
// there's nothing for a GM to undo. Only fulfilling one moves Tag Points and
// therefore needs a reason and a review.
export async function setDesire({ text: rawText, points: rawPoints }) {
  const { session, character } = await requireCharacter();

  const text = rawText?.toString().trim();
  if (!text) throw new Error("Describe your Desire.");
  const points = parseCount(rawPoints, { min: DESIRE_MIN_POINTS, max: DESIRE_MAX_POINTS });
  if (points == null) throw new Error(`Points must be between ${DESIRE_MIN_POINTS} and ${DESIRE_MAX_POINTS}.`);

  const openTurn = await getOpenTurn();
  const [active, lastEnded] = await Promise.all([
    prisma.desire.findFirst({ where: { characterId: character.id, status: "ACTIVE" } }),
    prisma.desire.findFirst({
      where: { characterId: character.id, status: { in: ["FULFILLED", "CANCELLED"] } },
      orderBy: { updatedAt: "desc" },
    }),
  ]);
  if (active) throw new Error("You already have an active Desire.");
  if (openTurn && lastEnded?.endedTurnNumber != null && openTurn.number <= lastEnded.endedTurnNumber) {
    throw new Error("You're on cooldown — you can set a new Desire next turn.");
  }

  await prisma.desire.create({
    data: {
      characterId: character.id,
      text: text.slice(0, 300),
      points,
      setTurnNumber: openTurn?.number ?? null,
    },
  });
  await prisma.auditLog.create({
    data: {
      actorDiscordUserId: session.discordUserId,
      actionType: "desire_set",
      targetCharacterId: character.id,
      details: { text: text.slice(0, 300), points },
    },
  });

  revalidatePath("/character");
  return { ok: true };
}

export async function cancelDesire() {
  const { session, character } = await requireCharacter();
  const openTurn = await getOpenTurn();

  const active = await prisma.desire.findFirst({ where: { characterId: character.id, status: "ACTIVE" } });
  if (!active) return { ok: true };

  await prisma.desire.update({
    where: { id: active.id },
    data: { status: "CANCELLED", endedTurnNumber: openTurn?.number ?? null },
  });
  await prisma.auditLog.create({
    data: {
      actorDiscordUserId: session.discordUserId,
      actionType: "desire_cancelled",
      targetCharacterId: character.id,
      details: { desireId: active.id },
    },
  });

  revalidatePath("/character");
  return { ok: true };
}

export async function fulfillDesireRequest({ reason: rawReason }) {
  const { session, character } = await requireCharacter();
  const reason = requireReason(rawReason);

  const openTurn = await getOpenTurn();
  const active = await prisma.desire.findFirst({ where: { characterId: character.id, status: "ACTIVE" } });
  if (!active) throw new Error("You have no active Desire.");

  await prisma.$transaction(async (tx) => {
    await tx.desire.update({
      where: { id: active.id },
      data: { status: "FULFILLED", endedTurnNumber: openTurn?.number ?? null },
    });
    await tx.character.update({
      where: { id: character.id },
      data: { tagPoints: { increment: active.points } },
    });
    await createRequest(tx, {
      characterId: character.id,
      turnId: openTurn?.id ?? null,
      type: "FULFILL_DESIRE",
      reason,
      payload: { desireId: active.id },
      effect: { desireId: active.id, desireText: active.text, pointsAwarded: active.points },
    });
    await logRequest(tx, {
      actorDiscordUserId: session.discordUserId,
      actionType: "request_fulfill_desire",
      targetCharacterId: character.id,
      reason,
      details: { desireId: active.id, pointsAwarded: active.points },
    });
  });

  revalidateAll();
  return { ok: true };
}
