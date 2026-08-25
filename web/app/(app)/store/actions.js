"use server";

import { revalidatePath } from "next/cache";
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
  chainSiblingsToRemove,
  effectiveCost,
  effectiveTotalCost,
} from "@/lib/characterCreation";
import { addToStack } from "@/lib/requestEffects";
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
    select: { id: true, name: true, tagPoints: true, tags: { select: { tagId: true } } },
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
    select: { id: true, pointCost: true, parentTagId: true, requiredTagId: true },
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
    // …and never a tier at or below one already held: its effective cost
    // would be zero or a refund, which is a point farm, not a purchase.
    if (chainSiblingsToRemove(tag, byId, heldIds).length > 0 && effectiveCost(tag, byId, heldIds) <= 0) {
      throw new UserError(`You already hold that tier of ${tag.name}'s chain or better.`);
    }
    // Belt and braces for the §4a rule that every negative tag is
    // purchasableAfterStart: false — the store never pays the buyer.
    if (effectiveCost(tag, byId, heldIds) < 0) {
      throw new UserError(`${tag.name} can't be bought mid-game.`);
    }
    // The per-tag prerequisite and the hidden-category group gate, satisfied
    // by what's held or bought alongside.
    if (!requirementSatisfied(tag, byId, heldOrSelectedIds)) {
      throw new UserError(`You're missing a prerequisite for ${tag.name}.`);
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

  await prisma.$transaction(async (tx) => {
    for (const tag of selected) {
      await addToStack(tx, character.id, tag.id, 1, {
        source: "POINT_BUY",
        // A timed tag has to arrive already stamped or it never expires —
        // same stamp createCharacter and the Add Tag request apply.
        expiresTurn: expiryFor(tag, openTurn),
        stackable: tag.stackable,
      });
    }
    if (totalPoints > 0) {
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
      effect: { items, totalPoints },
    });
    await logRequest(tx, {
      actorDiscordUserId: session.discordUserId,
      actionType: "request_buy_tags",
      targetCharacterId: character.id,
      reason: "Point-buy purchase",
      details: { tags: items.map((i) => i.tagName), totalPoints },
    });
  });

  // A bought tag can open a narrowcast channel (#radio, #intercom) the same
  // way a granted one does.
  await syncCharacterNarrowcastAccess(character.id);
  revalidatePath("/store");
  revalidatePath("/character");
  revalidatePath("/gm/turns");
  revalidatePath("/gm/audit");
}

export async function buyTags(input) {
  return guarded(() => buyTagsImpl(input));
}
