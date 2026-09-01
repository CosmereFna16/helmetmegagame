"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  prisma,
  MERCHANT_LICENSE_SLUG,
  DEPOT_ZONE_SLUG,
  DEPOT_CREDIT_CAP,
  creditAvailable,
  normalizeQuantity,
} from "@lifeweb/db";
import { auth } from "@/lib/auth";
import { getOpenTurn } from "@/lib/turn";
import { expiryFor } from "@/lib/turnFormat";
import { TURNS_PATH } from "@/lib/routes";
import { createRequest, logRequest, requireReason } from "@/lib/requests";
import { addToStack, dropCharacterTag, moveResources } from "@/lib/requestEffects";
import { UserError, guarded } from "@/lib/actionResult";

// The Merchant's three counters at the Depot. Same contract as every other
// player Request (docs/systemdocs/REQUESTS.md): authenticate, re-validate
// everything the client sent, then apply the effect and write the Request +
// AuditLog rows in ONE transaction, auto-passed for a GM to review after.
//
// What is different here is that the counterparty is not in the game. The
// orbital station has no balance to debit and no stock to run down, so each
// of these moves exactly one side — which is also why the snapshots below
// carry the unit price. A GM re-tuning docs/tags.yaml next week must not
// change what an Undo of today's sale reverses.

// The page gate is advisory; a server action is a public endpoint, so the
// licence is checked again here, and so is the zone. Standing at Customs is
// the second half: the Depot is a shuttle, and you cannot trade with a craft
// you are not next to — the same reach rule the Lifeweb applies at the tower.
async function requireLicensedMerchant() {
  const session = await auth();
  if (!session?.discordUserId) redirect("/");

  const character = await prisma.character.findFirst({
    where: { discordUserId: session.discordUserId, status: "ALIVE" },
    include: { tags: { include: { tag: true } }, zone: { select: { slug: true } } },
  });
  if (!character) throw new UserError("You need a living character to do that.");
  if (!character.tags.some((ct) => ct.tag.slug === MERCHANT_LICENSE_SLUG)) {
    throw new UserError("The Depot only deals with a licensed Merchant.");
  }
  if (character.zone?.slug !== DEPOT_ZONE_SLUG) {
    throw new UserError("The Depot is down at Customs. You have to be standing there.");
  }
  return { session, character };
}

function revalidateAll() {
  revalidatePath("/depot");
  revalidatePath("/character");
  revalidatePath("/gm/players", "layout");
  revalidatePath(TURNS_PATH, "page");
  revalidatePath("/gm/audit");
}


// The price is read from the catalog INSIDE the action, never taken from the
// client — the quantity is the only thing a caller gets to choose, and even
// that is clamped. `moveResources` is what actually enforces the balance: it
// is a conditional update, so two tabs buying the last ML-23 at once cannot
// both succeed.
async function depotBuyImpl({ tagId, quantity: rawQuantity, reason: rawReason }) {
  const { session, character } = await requireLicensedMerchant();
  const reason = requireReason(rawReason);

  const quantity = normalizeQuantity(rawQuantity);
  if (quantity == null) throw new UserError("That isn't a quantity the Depot will handle.");

  const tag = await prisma.tag.findUnique({ where: { id: tagId ?? "" } });
  if (!tag || tag.depotPrice == null) throw new UserError("The Depot doesn't stock that.");

  // A non-stackable ware can only ever be held once, so buying five would
  // charge for five and deliver one. The "already holds one" half of that is
  // re-checked inside the transaction below, where it belongs.
  if (!tag.stackable && quantity > 1) {
    throw new UserError(`You can only carry one ${tag.name}.`);
  }

  const unitPrice = tag.depotPrice;
  const total = unitPrice * quantity;
  if (character.resources < total) {
    throw new UserError(`That's ${total} ⬢ and you have ${character.resources}.`);
  }

  const openTurn = await getOpenTurn();

  await prisma.$transaction(async (tx) => {
    await moveResources(tx, { kind: "character", id: character.id }, -total);

    // Inside the transaction, because addToStack silently no-ops on a
    // non-stackable tag already held — which would take his ⬢ for goods that
    // never arrive. Checking out here and buying in there leaves a window a
    // second tab can fit through, and the @@unique index would then surface it
    // as a raw P2002 that guarded() rethrows and Next redacts to React #441.
    const before = await tx.characterTag.findUnique({
      where: { characterId_tagId: { characterId: character.id, tagId: tag.id } },
    });
    if (before && !tag.stackable) {
      throw new UserError(`You already have a ${tag.name}, and you can only carry one.`);
    }
    await addToStack(tx, character.id, tag.id, quantity, {
      source: "EVENT",
      stackable: tag.stackable,
      expiresTurn: expiryFor(tag, openTurn),
    });
    const added = tag.stackable ? quantity : before ? 0 : 1;

    const effect = { tagId: tag.id, tagName: tag.name, quantity, added, unitPrice, total };
    await createRequest(tx, {
      characterId: character.id,
      turnId: openTurn?.id ?? null,
      type: "DEPOT_BUY",
      reason,
      payload: { tagId: tag.id, quantity },
      effect,
    });
    await logRequest(tx, {
      actorDiscordUserId: session.discordUserId,
      actionType: "request_depot_buy",
      targetCharacterId: character.id,
      reason,
      details: effect,
    });
  });

  revalidateAll();
  return { tagName: tag.name, quantity, total };
}


// Selling snapshots the CharacterTag row before dropping it, so an Undo puts
// the goods back with the source and expiry they had rather than a fresh full
// duration — the same reason FREE_CHARACTER snapshots before it removes.
async function depotSellImpl({ tagId, quantity: rawQuantity, reason: rawReason }) {
  const { session, character } = await requireLicensedMerchant();
  const reason = requireReason(rawReason);

  const quantity = normalizeQuantity(rawQuantity);
  if (quantity == null) throw new UserError("That isn't a quantity the Depot will handle.");

  const tag = await prisma.tag.findUnique({ where: { id: tagId ?? "" } });
  if (!tag?.sellable || !(tag.sellablePrice > 0)) {
    throw new UserError("The Depot won't buy that.");
  }

  const held = await prisma.characterTag.findUnique({
    where: { characterId_tagId: { characterId: character.id, tagId: tag.id } },
  });
  if (!held) throw new UserError(`You don't have a ${tag.name} to sell.`);
  if (held.quantity < quantity) {
    throw new UserError(`You only have ${held.quantity} of those.`);
  }

  const unitPrice = tag.sellablePrice;
  const total = unitPrice * quantity;
  const openTurn = await getOpenTurn();

  await prisma.$transaction(async (tx) => {
    await dropCharacterTag(tx, character.id, tag.id, quantity);
    await moveResources(tx, { kind: "character", id: character.id }, total);

    const effect = {
      tagId: tag.id,
      tagName: tag.name,
      quantity,
      unitPrice,
      total,
      restore: { tagId: tag.id, source: held.source, expiresTurn: held.expiresTurn },
    };
    await createRequest(tx, {
      characterId: character.id,
      turnId: openTurn?.id ?? null,
      type: "DEPOT_SELL",
      reason,
      payload: { tagId: tag.id, quantity },
      effect,
    });
    await logRequest(tx, {
      actorDiscordUserId: session.discordUserId,
      actionType: "request_depot_sell",
      targetCharacterId: character.id,
      reason,
      details: effect,
    });
  });

  revalidateAll();
  return { tagName: tag.name, quantity, total };
}


// Draw and repay are one action because they are one ledger, and doing them
// separately would mean two places that have to agree about the cap.
//
// The cap is enforced by a CONDITIONAL updateMany, the same shape and for the
// same reason as moveResources: the write is the check.
//
// It was an absolute `set` of a debt read before the transaction, which is a
// lost update rather than an overshoot — two draws of 30 both read 0, both set
// 30, and he ends up holding 60 ⬢ while owing 30. Worse, it did not compose
// with DEPOT_CREDIT's Undo, which moves the tab RELATIVELY: repaying a draw
// and then undoing it decremented a tab already back at 0, leaving −30, which
// creditAvailable would once have reported as 90 ⬢ of headroom. Apply and undo
// now both move the tab by a delta, so they compose in any order.
async function depotCreditImpl({ direction, amount: rawAmount, reason: rawReason }) {
  const { session, character } = await requireLicensedMerchant();
  const reason = requireReason(rawReason);

  const draw = direction === "DRAW";
  if (!draw && direction !== "REPAY") throw new UserError("That isn't something the Depot does.");

  const amount = Number(rawAmount);
  if (!Number.isInteger(amount) || amount < 1) {
    throw new UserError("Name a whole number of ⬢, at least 1.");
  }

  const debtBefore = character.depotDebt ?? 0;
  if (draw) {
    const available = creditAvailable(debtBefore);
    if (amount > available) {
      throw new UserError(
        available === 0
          ? `You're at the ${DEPOT_CREDIT_CAP} ⬢ ceiling. Pay some back first.`
          : `The Company will advance you ${available} ⬢ more, not ${amount}.`,
      );
    }
  } else {
    if (amount > debtBefore) {
      throw new UserError(
        debtBefore === 0 ? "You don't owe the Company anything." : `You only owe ${debtBefore} ⬢.`,
      );
    }
    if (character.resources < amount) {
      throw new UserError(`That's ${amount} ⬢ and you have ${character.resources}.`);
    }
  }

  const debtAfter = draw ? debtBefore + amount : debtBefore - amount;
  const openTurn = await getOpenTurn();

  await prisma.$transaction(async (tx) => {
    // The tab first, so a cap breach rolls back before any ⬢ move. Drawing
    // matches only while the debt still leaves room; repaying only while the
    // debt is still there to pay. A count of 0 means somebody else got there
    // between the friendly check above and this write.
    const { count } = await tx.character.updateMany({
      where: draw
        ? { id: character.id, depotDebt: { lte: DEPOT_CREDIT_CAP - amount } }
        : { id: character.id, depotDebt: { gte: amount } },
      data: { depotDebt: draw ? { increment: amount } : { decrement: amount } },
    });
    if (!count) {
      throw new UserError(
        draw
          ? `The Company won't advance that much — your balance moved. Reload and try again.`
          : "Your balance moved. Reload and try again.",
      );
    }
    await moveResources(tx, { kind: "character", id: character.id }, draw ? amount : -amount);

    const effect = { direction: draw ? "DRAW" : "REPAY", amount, debtBefore, debtAfter };
    await createRequest(tx, {
      characterId: character.id,
      turnId: openTurn?.id ?? null,
      type: "DEPOT_CREDIT",
      reason,
      payload: { direction: effect.direction, amount },
      effect,
    });
    await logRequest(tx, {
      actorDiscordUserId: session.discordUserId,
      actionType: "request_depot_credit",
      targetCharacterId: character.id,
      reason,
      details: effect,
    });
  });

  revalidateAll();
  return { direction: draw ? "DRAW" : "REPAY", amount, debtAfter };
}


// Validation comes back as { ok: false, error } rather than thrown — a
// production Next.js build redacts anything thrown out of a Server Action.
// See web/lib/actionResult.js.

export async function depotBuy(input) {
  return guarded(() => depotBuyImpl(input));
}

export async function depotSell(input) {
  return guarded(() => depotSellImpl(input));
}

export async function depotCredit(input) {
  return guarded(() => depotCreditImpl(input));
}
