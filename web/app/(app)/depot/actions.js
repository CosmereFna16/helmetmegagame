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

// --- buy --------------------------------------------------------------

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

  // A non-stackable ware can only ever be held once. Buying five and
  // receiving one — or buying a second and receiving nothing, which is what
  // addToStack does with a tag already held — would take his ⬢ for goods that
  // never arrive. Refuse both cases up front rather than charging for air.
  if (!tag.stackable) {
    if (quantity > 1) throw new UserError(`You can only carry one ${tag.name}.`);
    const alreadyHeld = await prisma.characterTag.findUnique({
      where: { characterId_tagId: { characterId: character.id, tagId: tag.id } },
    });
    if (alreadyHeld) throw new UserError(`You already have a ${tag.name}, and you can only carry one.`);
  }

  const unitPrice = tag.depotPrice;
  const total = unitPrice * quantity;
  if (character.resources < total) {
    throw new UserError(`That's ${total} ⬢ and you have ${character.resources}.`);
  }

  const openTurn = await getOpenTurn();

  await prisma.$transaction(async (tx) => {
    await moveResources(tx, { kind: "character", id: character.id }, -total);

    // `added` is what actually landed on the sheet — 0 for a non-stackable
    // ware he already held. Undo may only take back what this request really
    // put there, so the snapshot records the truth rather than the ask.
    const before = await tx.characterTag.findUnique({
      where: { characterId_tagId: { characterId: character.id, tagId: tag.id } },
    });
    await addToStack(tx, character.id, tag.id, quantity, {
      source: "EVENT",
      stackable: tag.stackable,
      expiresTurn:
        openTurn && tag.defaultDurationTurns != null
          ? openTurn.number + tag.defaultDurationTurns
          : null,
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

// --- sell -------------------------------------------------------------

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

// --- credit -----------------------------------------------------------

// Draw and repay are one action because they are one ledger, and doing them
// separately would mean two places that have to agree about the cap.
//
// The debt read for the cap check comes from the character loaded a moment
// ago, so two simultaneous draws could in principle both pass it. That is
// deliberate and bounded: the worst case overshoots the ceiling by one draw
// and shows up on /gm/turns as two rows a GM can undo. The ⬢ half is still
// exact, because moveResources is conditional. Making the tab itself
// race-proof would mean a conditional update on depotDebt, which is not worth
// the complexity for a single-holder counter.
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
    await moveResources(tx, { kind: "character", id: character.id }, draw ? amount : -amount);
    await tx.character.update({
      where: { id: character.id },
      data: { depotDebt: debtAfter },
    });

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

// --- public surface ---------------------------------------------------

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
