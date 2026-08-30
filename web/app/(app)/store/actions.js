"use server";

import { revalidatePath } from "next/cache";
import { TURNS_PATH } from "@/lib/routes";
import { redirect } from "next/navigation";
import { prisma } from "@lifeweb/db";
import { auth } from "@/lib/auth";
import { getOpenTurn } from "@/lib/turn";
import { createRequest, logRequest } from "@/lib/requests";
import { UserError, guarded } from "@/lib/actionResult";
import { expiryFor } from "@/lib/turnFormat";
import {
  tagsById as buildTagsById,
  requirementSatisfied,
  exclusiveConflict,
  chainSiblingsToRemove,
  heldHigherTiers,
  effectiveCost,
  effectiveTotalCost,
} from "@/lib/characterCreation";
import { addToStack, dropCharacterTag } from "@/lib/requestEffects";
import { syncCharacterNarrowcastAccess } from "@/lib/discordGuild";

// The /store checkout. One cart, one transaction, ONE batched BUY_TAGS
// request — applied immediately and reviewed by a GM afterwards, the same
// contract as every other request (REQUESTS.md). Undo lives in
// web/lib/requestEffects.js and returns the whole cart.
//
// A server action is a public endpoint: everything the client enforced is
// re-derived and re-checked here against the catalog and the character's
// actual sheet, never trusted from the post.
async function buyTagsImpl({ tagIds }) {
  const session = await auth();
  if (!session?.discordUserId) redirect("/");
  const character = await prisma.character.findFirst({
    where: { discordUserId: session.discordUserId, status: "ALIVE" },
    select: {
      id: true,
      name: true,
      tagPoints: true,
      // Full rows, not bare ids: an upgrade replaces the held lower tier, and
      // the snapshot Undo restores needs source/expiry/quantity as they were.
      tags: { select: { tagId: true, source: true, expiresTurn: true, quantity: true } },
    },
  });
  if (!character) redirect("/character");

  const ids = [...new Set((Array.isArray(tagIds) ? tagIds : []).map(String))];
  if (ids.length === 0) throw new UserError("Nothing in the cart.");
  if (ids.length > 50) throw new UserError("That's too many tags at once.");

  const heldIds = character.tags.map((ct) => ct.tagId);
  const held = new Set(heldIds);

  const selected = await prisma.tag.findMany({
    where: { id: { in: ids } },
    include: { group: { select: { requiredTagId: true } } },
  });
  if (selected.length !== ids.length) throw new UserError("Unknown tag in the cart.");

  // The whole catalog's ids/parents/costs, so chain walks never dead-end on
  // an ancestor the cart didn't include — same reason createCharacter loads
  // it.
  const allTags = await prisma.tag.findMany({
    // `name` rides along for the replaced-tier snapshots below — the effect
    // names what came off the sheet so the GM ledger reads without a join.
    // `exclusive` is what exclusiveConflict() reads off the held row.
    select: {
      id: true,
      name: true,
      pointCost: true,
      parentTagId: true,
      requiredTagId: true,
      exclusive: true,
      groupId: true,
      removable: true,
      consumable: true,
    },
  });
  const byId = buildTagsById(allTags);
  const heldOrSelectedIds = [...heldIds, ...ids];

  for (const tag of selected) {
    // The store's own gate — creation-only picks never arrive as a purchase.
    if (!tag.purchasable || !tag.purchasableAfterStart) {
      throw new UserError(`${tag.name} isn't for sale.`);
    }
    // Toggle-set, never a stack: what's owned can't be bought again. Stacks
    // are built in play through the Add Tag request.
    if (held.has(tag.id)) throw new UserError(`You already have ${tag.name}.`);
    // One tier of a chain per cart (a chain replaces, it doesn't stack)…
    if (chainSiblingsToRemove(tag, byId, ids).length > 0) {
      throw new UserError("You can only buy one tier of the same skill chain.");
    }
    // …never a tier BELOW one already held — a chain replaces upward, it
    // never re-opens downward, so a downgrade is not a purchase at all…
    if (heldHigherTiers(tag, byId, heldIds).length > 0) {
      throw new UserError(`You already hold a higher tier of ${tag.name}'s chain.`);
    }
    // …and never a tier at or below one already paid through: its effective
    // cost would be zero or a refund, which is a point farm, not a purchase.
    if (chainSiblingsToRemove(tag, byId, heldIds).length > 0 && effectiveCost(tag, byId, heldIds) <= 0) {
      throw new UserError(`You already hold that tier of ${tag.name}'s chain or better.`);
    }
    // A tag the store PAYS for (the Addictions) must be one the player can
    // never hand back: remove/consume refund ⬢ but not Tag Points, so a
    // removable negative tag is buy → remove → buy again, forever. This is
    // the real invariant behind TAGS.md §4 — checked here rather than trusted
    // to the YAML, because a GM-authored custom tag or a future YAML edit can
    // set the flags either way, and because the live catalog is only as
    // current as the last db:sync-tags.
    if (effectiveCost(tag, byId, heldIds) < 0 && (tag.removable || tag.consumable)) {
      throw new UserError(`${tag.name} can't be bought mid-game.`);
    }
    //
    // The per-tag prerequisite and the hidden-category group gate, satisfied
    // by what's held or bought alongside.
    if (!requirementSatisfied(tag, byId, heldOrSelectedIds)) {
      throw new UserError(`You're missing a prerequisite for ${tag.name}.`);
    }
    // One exclusive tag at a time (the Beliefs). Conversion is still "drop
    // one, buy another" — beliefs stay removable — so the error says so.
    const conflict = exclusiveConflict(tag, heldOrSelectedIds, byId);
    if (conflict) {
      throw new UserError(
        `You already hold ${conflict.name}; drop it first to take ${tag.name}.`,
      );
    }
  }

  // Chain-aware and discounted by held tiers — the same arithmetic the shelf
  // showed. Never trusted from the client.
  const totalPoints = effectiveTotalCost(selected, byId, heldIds);
  if (totalPoints > character.tagPoints) {
    throw new UserError(`That costs ${totalPoints} points and you have ${character.tagPoints}.`);
  }

  const openTurn = await getOpenTurn();
  const items = selected.map((tag) => ({
    tagId: tag.id,
    tagName: tag.name,
    cost: effectiveCost(tag, byId, heldIds),
  }));

  // A chain replaces: buying a higher tier takes the held lower tier off the
  // sheet in the same transaction (TAGS.md §3). Snapshots go on the effect so
  // Undo is an exact inverse — return the cart, restore what it displaced.
  const replaced = [];

  await prisma.$transaction(async (tx) => {
    for (const tag of selected) {
      for (const lowerId of chainSiblingsToRemove(tag, byId, heldIds)) {
        const row = character.tags.find((ct) => ct.tagId === lowerId);
        if (!row) continue;
        replaced.push({
          tagId: row.tagId,
          tagName: byId.get(row.tagId)?.name ?? null,
          source: row.source,
          expiresTurn: row.expiresTurn,
          quantity: row.quantity,
        });
        await dropCharacterTag(tx, character.id, row.tagId);
      }
      await addToStack(tx, character.id, tag.id, 1, {
        source: "POINT_BUY",
        // A timed tag has to arrive already stamped or it never expires —
        // same stamp createCharacter and the Add Tag request apply.
        expiresTurn: expiryFor(tag, openTurn),
        stackable: tag.stackable,
      });
    }
    // `!== 0`, not `> 0`: a cart of Addictions has a NEGATIVE total, and
    // decrementing by a negative is the credit that pays the buyer. Guarding
    // on `> 0` skipped the write entirely and gave the Cultist nothing.
    if (totalPoints !== 0) {
      await tx.character.update({
        where: { id: character.id },
        data: { tagPoints: { decrement: totalPoints } },
      });
    }
    await createRequest(tx, {
      characterId: character.id,
      turnId: openTurn?.id ?? null,
      type: "BUY_TAGS",
      reason: "Point-buy purchase",
      payload: { tagIds: ids },
      // `replaced` only when an upgrade displaced something — older effects
      // without the key keep their exact shape, and Undo treats absence as [].
      effect: replaced.length ? { items, totalPoints, replaced } : { items, totalPoints },
    });
    await logRequest(tx, {
      actorDiscordUserId: session.discordUserId,
      actionType: "request_buy_tags",
      targetCharacterId: character.id,
      reason: "Point-buy purchase",
      details: {
        tags: items.map((i) => i.tagName),
        totalPoints,
        ...(replaced.length ? { replacedTiers: replaced.map((r) => r.tagName) } : {}),
      },
    });
  });

  // A bought tag can open a narrowcast channel (#watch, #intercom) the same
  // way a granted one does.
  await syncCharacterNarrowcastAccess(character.id);
  revalidatePath("/store");
  revalidatePath("/character");
  revalidatePath(TURNS_PATH, "page");
  revalidatePath("/gm/audit");
}

export async function buyTags(input) {
  return guarded(() => buyTagsImpl(input));
}
