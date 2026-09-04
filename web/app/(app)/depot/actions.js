"use server";

import { revalidatePath } from "next/cache";
import { afterInventoryChange } from "@/lib/afterInventoryChange";
import { redirect } from "next/navigation";
import {
  prisma,
  MERCHANT_LICENSE_SLUG,
  DEPOT_LOCATION_SLUG,
  DEPOT_KEYCARD_SLUG,
  COAL_SLUG,
  SALTPETER_SLUG,
  OBOL_SLUG,
  LANDING_PAD_SLUG,
  normalizeQuantity,
  loadDepot,
  bumpAccount,
  bumpDebt,
  bumpFuel,
  depotPowered,
  creditAvailableObols,
  obolsToPay,
  obolsEarned,
  shipmentId,
  splitIntoCrates,
  crateTagData,
  canOpenCrate,
} from "@lifeweb/db";
import { auth } from "@/lib/auth";
import { isSuperadmin } from "@/lib/superadmin";
import { getOpenTurn } from "@/lib/turn";
import { expiryForGrant } from "@lifeweb/db/lib/grantExpiry";
import { TURNS_PATH } from "@/lib/routes";
import { createRequest, logRequest, requireReason } from "@/lib/requests";
import { addToStack, dropCharacterTag, addToRoomStack, dropRoomTag } from "@/lib/requestEffects";
import { UserError, guarded } from "@/lib/actionResult";

// The Merchant's station. Same contract as every other player Request
// (docs/systemdocs/REQUESTS.md): authenticate, re-validate everything the
// client sent, then apply the effect and write the Request + AuditLog rows in
// ONE transaction, auto-passed for a GM to review after.
//
// Two things are different here from the rest of the app.
//
// The money is obols, and it lives on the Depot row rather than on anybody's
// character. The licence is tradeable, so handing it over hands over the
// account — which is the point, and the reason nothing below reads
// `character.resources` for a price.
//
// And the counterparty is not in the game. The orbital station has no balance
// to debit and no stock to run down, so each of these moves exactly one side.
// That is also why every snapshot below carries the unit price: a GM
// re-tuning docs/tags.yaml next week must not change what an Undo of today's
// order reverses.

// One line item's worth of sanity on an order, so a fat-fingered manifest
// cannot file for ten thousand vials.
const MAX_ORDER_LINES = 40;

// A page gate is advisory; a server action is a public endpoint. Everything
// below re-checks the licence AND that the Merchant is standing at the Depot.
// The Depot is a hangar in the caves — you cannot run it by remote.
async function requireLicensedMerchant({ needsPower = true } = {}) {
  const session = await auth();
  if (!session?.discordUserId) redirect("/");

  const character = await prisma.character.findFirst({
    where: { discordUserId: session.discordUserId, status: "ALIVE" },
    include: { tags: { include: { tag: true } }, location: { select: { slug: true, id: true } } },
  });
  if (!character) throw new UserError("You need a living character to do that.");
  if (!character.tags.some((ct) => ct.tag.slug === MERCHANT_LICENSE_SLUG)) {
    throw new UserError("The Depot only answers to a licensed Merchant. ‡");
  }
  if (character.location?.slug !== DEPOT_LOCATION_SLUG) {
    throw new UserError("The Depot is its own room in the caves. You have to be standing in it. ‡");
  }

  const depot = await loadDepot(prisma);

  // The generator gates almost everything, and it has to be checked here
  // rather than trusted from the disabled button the client rendered. The
  // power switch itself is the one action that must work in the dark.
  if (needsPower && !depotPowered(depot)) {
    throw new UserError("The generator is out. Nothing here runs without it. ‡");
  }

  return { session, character, depot };
}

// Opening a crate is the one thing a Docker can do, so it has its own gate:
// the keycard, not the licence, and no standing requirement — a crate that
// walked out of the landing pad can be cracked wherever it ended up.
async function requireCharacter() {
  const session = await auth();
  if (!session?.discordUserId) redirect("/");
  const character = await prisma.character.findFirst({
    where: { discordUserId: session.discordUserId, status: "ALIVE" },
    include: { tags: { include: { tag: true } } },
  });
  if (!character) throw new UserError("You need a living character to do that.");
  return { session, character };
}

function heldSlugSet(character) {
  return new Set(character.tags.map((ct) => ct.tag.slug));
}

function revalidateAll() {
  revalidatePath("/depot");
  revalidatePath("/character");
  revalidatePath("/gm/players", "layout");
  revalidatePath(TURNS_PATH, "page");
  revalidatePath("/gm/audit");
}

// The landing pad, loaded with its stash. Every shuttle action works through
// this one room, so a missing row is a sync problem worth naming out loud
// rather than a silent no-op.
async function landingPad(tx = prisma) {
  const room = await tx.room.findUnique({
    where: { slug: LANDING_PAD_SLUG },
    include: { tags: { include: { tag: true } } },
  });
  if (!room) {
    throw new UserError("The landing pad isn't in the database yet — a GM needs to run the zone sync. ‡");
  }
  return room;
}

// ─────────────────────────────────────────────────────────────────────────
// Ordering
// ─────────────────────────────────────────────────────────────────────────

// A whole cart in one Request, the way BUY_TAGS files a point-buy cart. Prices
// are read from the catalog in here; the client's are decoration.
//
// The obols leave the account NOW and the goods do not exist yet — that gap is
// the whole risk of the business, and it is why the shuttle clock matters.
async function depotOrderImpl({ items: rawItems, reason: rawReason }) {
  const { session, character, depot } = await requireLicensedMerchant();
  const reason = requireReason(rawReason);

  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    throw new UserError("Nothing on the manifest. ‡");
  }
  if (rawItems.length > MAX_ORDER_LINES) {
    throw new UserError(`That's more than ${MAX_ORDER_LINES} line items. Split the order. ‡`);
  }

  // Collapse duplicate lines before pricing, so the same ware sent twice is
  // one line rather than two rows that each pass the quantity clamp.
  const wanted = new Map();
  for (const item of rawItems) {
    const quantity = normalizeQuantity(item?.quantity);
    if (quantity == null) throw new UserError("That isn't a quantity the Depot will handle. ‡");
    wanted.set(item?.tagId ?? "", (wanted.get(item?.tagId ?? "") ?? 0) + quantity);
  }

  const tags = await prisma.tag.findMany({
    where: { id: { in: [...wanted.keys()] }, depotPrice: { not: null } },
  });
  if (tags.length !== wanted.size) throw new UserError("The Depot doesn't stock one of those. ‡");

  let totalResources = 0;
  const lines = [];
  for (const tag of tags) {
    const quantity = wanted.get(tag.id);
    // The whole quantity is re-clamped after the merge above, not just each
    // submitted line — otherwise two lines of 99 would slip 198 through.
    if (normalizeQuantity(quantity) == null) {
      throw new UserError(`That's more ${tag.name} than the station will put on one shuttle. ‡`);
    }
    const unitPrice = tag.depotPrice;
    totalResources += unitPrice * quantity;
    lines.push({
      tagId: tag.id,
      name: tag.name,
      quantity,
      unitPrice,
      sealed: Boolean(tag.sealedShipping),
    });
  }

  // The catalog prices in ⬢; the account pays in obols. Converted on the
  // total, so a cart of cheap things is not rounded to death one line at a
  // time. See db/lib/depotState.js#obolsToPay.
  const total = obolsToPay(totalResources, depot.obolRate);
  if ((depot.accountObols ?? 0) < total) {
    throw new UserError(`That order is ${total} ¢ and the account holds ${depot.accountObols ?? 0}. ‡`);
  }

  const openTurn = await getOpenTurn();
  const existing = Array.isArray(depot.manifest) ? depot.manifest : [];

  await prisma.$transaction(async (tx) => {
    // The conditional clamp inside bumpAccount is what actually enforces the
    // balance — two tabs ordering the last of the money cannot both succeed.
    const moved = await bumpAccount(tx, -total);
    if (-moved.delta < total) {
      throw new UserError("The account moved while you were ordering. Try again. ‡");
    }

    await tx.depot.update({
      where: { id: 1 },
      data: { manifest: [...existing, ...lines] },
    });

    const effect = { lines, total, totalResources, manifestBefore: existing, manifestAfter: [...existing, ...lines] };
    await createRequest(tx, {
      characterId: character.id,
      turnId: openTurn?.id ?? null,
      type: "DEPOT_ORDER",
      reason,
      payload: { lines: lines.map((l) => ({ tagId: l.tagId, quantity: l.quantity })) },
      effect,
    });
    await logRequest(tx, {
      actorDiscordUserId: session.discordUserId,
      actionType: "request_depot_order",
      targetCharacterId: character.id,
      reason,
      details: effect,
    });
  });

  revalidateAll();
  return { lines: lines.length, total };
}

// ─────────────────────────────────────────────────────────────────────────
// The shuttle
// ─────────────────────────────────────────────────────────────────────────

// Calling it down. Everything on the manifest becomes crates on the landing
// pad; an empty manifest still brings the shuttle, because he also needs it
// down to load goods going the other way.
async function depotCallShuttleImpl({ reason: rawReason }) {
  const { session, character, depot } = await requireLicensedMerchant();
  const reason = requireReason(rawReason);

  if (depot.shuttleState !== "AWAY") {
    throw new UserError("The shuttle is already down. ‡");
  }

  const room = await landingPad();
  const manifest = Array.isArray(depot.manifest) ? depot.manifest : [];
  const openTurn = await getOpenTurn();

  const shipment = shipmentId();
  const crates = splitIntoCrates(manifest);

  // Crates need a group so they render like any other item in the UI. The
  // gear group is the catch-all the catalog already uses for carried objects.
  const group = await prisma.tagGroup.findUnique({ where: { slug: "items-gear" } });

  await prisma.$transaction(async (tx) => {
    for (const data of crateTagData(shipment, crates, { groupId: group?.id ?? null })) {
      const { crateContents, ...tagFields } = data;
      const tag = await tx.tag.create({ data: { ...tagFields, crateContents } });
      await addToRoomStack(tx, room.id, tag.id, 1);
    }

    await tx.depot.update({
      where: { id: 1 },
      data: {
        shuttleState: "DOCKED",
        shuttleTurn: openTurn?.number ?? null,
        manifest: [],
      },
    });

    const effect = { shipment, crates: crates.length, manifest, roomId: room.id };
    await createRequest(tx, {
      characterId: character.id,
      turnId: openTurn?.id ?? null,
      type: "DEPOT_SHIP",
      reason,
      payload: { direction: "DOWN" },
      effect: { ...effect, direction: "DOWN" },
    });
    await logRequest(tx, {
      actorDiscordUserId: session.discordUserId,
      actionType: "request_depot_shuttle_call",
      targetCharacterId: character.id,
      reason,
      details: effect,
    });
  });

  revalidateAll();
  return { shipment, crates: crates.length };
}

// Sending it back, loaded. Everything sitting on the landing pad goes up and
// comes back as obols: tags at their sellablePrice, and the room's ⬢ stash at
// the Depot's own exchange rate. This is the ONLY way Resources become obols,
// which is what stops the Merchant printing money at a keyboard.
async function depotSendShuttleImpl({ reason: rawReason }) {
  const { session, character, depot } = await requireLicensedMerchant();
  const reason = requireReason(rawReason);

  if (depot.shuttleState !== "DOCKED") throw new UserError("The shuttle isn't here. ‡");

  const openTurn = await getOpenTurn();
  const landed = depot.shuttleTurn ?? openTurn?.number ?? 0;
  const cooldown = depot.shuttleCooldown ?? 0;
  if (openTurn && openTurn.number - landed < cooldown) {
    throw new UserError("It only just landed. Give the crew a turn to work. ‡");
  }

  const room = await landingPad();

  // A crate going back up is worth what is inside it, not nothing — otherwise
  // an unopened shipment would be destroyed by returning it, which reads as a
  // bug however you explain it.
  const rate = depot.obolRate ?? 5;
  let goodsResources = 0;
  const soldTags = [];
  for (const rt of room.tags) {
    const unit = rt.tag.sellablePrice ?? 0;
    if (unit > 0) goodsResources += unit * rt.quantity;
    soldTags.push({ tagId: rt.tagId, name: rt.tag.name, quantity: rt.quantity, unitPrice: unit });
  }
  // The goods and the loose ⬢ in the stash are ONE pool, converted once. Two
  // separate conversions would round the Merchant down twice for no reason
  // a player could explain.
  const resources = room.resources ?? 0;
  const payout = obolsEarned(goodsResources + resources, rate);
  // Everything on the pad goes up, including the ⬢ — the shuttle is loaded,
  // not partially loaded, and a remainder left behind in an empty room would
  // be a rounding artifact nobody could find.
  const resourcesSpent = resources;

  await prisma.$transaction(async (tx) => {
    for (const rt of room.tags) {
      await dropRoomTag(tx, room.id, rt.tagId, null);
      // A runtime crate tag with nothing left pointing at it is litter. The
      // catalog row goes with the last instance.
      if (rt.tag.custom) {
        const stillHeld = await tx.characterTag.count({ where: { tagId: rt.tagId } });
        const stillStashed = await tx.roomTag.count({ where: { tagId: rt.tagId } });
        if (stillHeld === 0 && stillStashed === 0) {
          await tx.tag.delete({ where: { id: rt.tagId } }).catch(() => {});
        }
      }
    }
    if (resourcesSpent > 0) {
      await tx.room.update({
        where: { id: room.id },
        data: { resources: { decrement: resourcesSpent } },
      });
    }
    await bumpAccount(tx, payout);
    await tx.depot.update({
      where: { id: 1 },
      data: { shuttleState: "AWAY", shuttleTurn: openTurn?.number ?? null },
    });

    const effect = {
      direction: "UP",
      soldTags,
      resourcesSpent,
      goodsResources,
      payout,
      roomId: room.id,
    };
    await createRequest(tx, {
      characterId: character.id,
      turnId: openTurn?.id ?? null,
      type: "DEPOT_SHIP",
      reason,
      payload: { direction: "UP" },
      effect,
    });
    await logRequest(tx, {
      actorDiscordUserId: session.discordUserId,
      actionType: "request_depot_shuttle_send",
      targetCharacterId: character.id,
      reason,
      details: effect,
    });
  });

  revalidateAll();
  return { payout, sold: soldTags.length, resourcesSpent };
}

// ─────────────────────────────────────────────────────────────────────────
// Crates
// ─────────────────────────────────────────────────────────────────────────

// Cracking one open. A Docker may do this — it is the job — but a SEALED
// crate wants the keycard, which is what makes the dangerous half of a
// shipment worth guarding.
async function openCrateImpl({ tagId, reason: rawReason }) {
  const { session, character } = await requireCharacter();
  const reason = requireReason(rawReason);

  const held = await prisma.characterTag.findFirst({
    where: { characterId: character.id, tagId: tagId ?? "" },
    include: { tag: true },
  });
  if (!held) throw new UserError("You aren't carrying that crate. ‡");

  const crate = held.tag;
  const contents = Array.isArray(crate.crateContents) ? crate.crateContents : null;
  if (!crate.custom || !contents) throw new UserError("That isn't a crate. ‡");

  if (!canOpenCrate(crate, heldSlugSet(character))) {
    throw new UserError("It's sealed, and the lock wants a Depot Keycard. ‡");
  }

  const openTurn = await getOpenTurn();
  const inner = await prisma.tag.findMany({ where: { id: { in: contents.map((c) => c.tagId) } } });
  const byId = new Map(inner.map((t) => [t.id, t]));

  const granted = [];
  await prisma.$transaction(async (tx) => {
    for (const line of contents) {
      const tag = byId.get(line.tagId);
      // A ware pruned out of the catalog between landing and opening is gone.
      // Skipping it beats throwing: the rest of the crate should still open.
      if (!tag) continue;
      await addToStack(tx, character.id, tag.id, line.quantity, {
        source: "EVENT",
        stackable: tag.stackable,
        expiresTurn: await expiryForGrant(tx, tag, openTurn, {
          characterId: character.id,
          where: "openCrate",
        }),
      });
      granted.push({ tagId: tag.id, name: tag.name, quantity: tag.stackable ? line.quantity : 1 });
    }

    await dropCharacterTag(tx, character.id, crate.id, null);

    const effect = { crateTagId: crate.id, crateName: crate.name, sealed: crate.sealedShipping, granted };
    await createRequest(tx, {
      characterId: character.id,
      turnId: openTurn?.id ?? null,
      type: "DEPOT_CRATE_OPEN",
      reason,
      payload: { tagId: crate.id },
      effect,
    });
    await logRequest(tx, {
      actorDiscordUserId: session.discordUserId,
      actionType: "request_depot_crate_open",
      targetCharacterId: character.id,
      reason,
      details: effect,
    });

    // The crate is a one-off catalog row and this was the last of it.
    const stillHeld = await tx.characterTag.count({ where: { tagId: crate.id } });
    const stillStashed = await tx.roomTag.count({ where: { tagId: crate.id } });
    if (stillHeld === 0 && stillStashed === 0) {
      await tx.tag.delete({ where: { id: crate.id } }).catch(() => {});
    }
  });

  await afterInventoryChange(character.id);
  revalidateAll();
  return { granted };
}

// ─────────────────────────────────────────────────────────────────────────
// The bank
// ─────────────────────────────────────────────────────────────────────────

// The ATM: the account balance on one side, physical coins on the other. This
// is the only door obols enter and leave the world through, which is what
// makes the Merchant the only faucet of currency in the game.
async function depotAtmImpl({ direction: rawDirection, amount: rawAmount, reason: rawReason }) {
  const { session, character, depot } = await requireLicensedMerchant();
  const reason = requireReason(rawReason);

  const direction = rawDirection === "DEPOSIT" ? "DEPOSIT" : "WITHDRAW";
  const amount = Number(rawAmount);
  if (!Number.isInteger(amount) || amount < 1) throw new UserError("That isn't an amount. ‡");

  const obol = await prisma.tag.findUnique({ where: { slug: OBOL_SLUG } });
  if (!obol) throw new UserError("The obol isn't in the catalog yet — a GM needs to run the tag sync. ‡");

  const withdrawing = direction === "WITHDRAW";
  if (withdrawing && (depot.accountObols ?? 0) < amount) {
    throw new UserError(`The account holds ${depot.accountObols ?? 0} ¢. ‡`);
  }

  const held = await prisma.characterTag.findUnique({
    where: { characterId_tagId: { characterId: character.id, tagId: obol.id } },
  });
  if (!withdrawing && (held?.quantity ?? 0) < amount) {
    throw new UserError(`You're carrying ${held?.quantity ?? 0} ¢. ‡`);
  }

  const openTurn = await getOpenTurn();

  await prisma.$transaction(async (tx) => {
    const moved = await bumpAccount(tx, withdrawing ? -amount : amount);
    if (Math.abs(moved.delta) < amount) {
      throw new UserError("The account moved while you were counting. Try again. ‡");
    }
    if (withdrawing) {
      await addToStack(tx, character.id, obol.id, amount, { source: "EVENT", stackable: true });
    } else {
      await dropCharacterTag(tx, character.id, obol.id, amount);
    }

    const effect = { direction, amount, balanceBefore: moved.before, balanceAfter: moved.after };
    await createRequest(tx, {
      characterId: character.id,
      turnId: openTurn?.id ?? null,
      type: "DEPOT_ATM",
      reason,
      payload: { direction, amount },
      effect,
    });
    await logRequest(tx, {
      actorDiscordUserId: session.discordUserId,
      actionType: "request_depot_atm",
      targetCharacterId: character.id,
      reason,
      details: effect,
    });
  });

  await afterInventoryChange(character.id);
  revalidateAll();
  return { direction, amount };
}

// The Company's line, in obols. Drawing puts money in the account; repaying
// takes it back out. The cap is refused rather than clamped, so he is told
// he hit the ceiling instead of quietly getting less than he asked for.
async function depotCreditImpl({ direction: rawDirection, amount: rawAmount, reason: rawReason }) {
  const { session, character, depot } = await requireLicensedMerchant();
  const reason = requireReason(rawReason);

  const draw = rawDirection !== "REPAY";
  const amount = Number(rawAmount);
  if (!Number.isInteger(amount) || amount < 1) throw new UserError("That isn't an amount. ‡");

  if (draw && amount > creditAvailableObols(depot)) {
    throw new UserError(`The line only has ${creditAvailableObols(depot)} ¢ left on it. ‡`);
  }
  if (!draw && amount > (depot.debtObols ?? 0)) {
    throw new UserError(`You only owe ${depot.debtObols ?? 0} ¢. ‡`);
  }
  if (!draw && amount > (depot.accountObols ?? 0)) {
    throw new UserError(`The account only holds ${depot.accountObols ?? 0} ¢. ‡`);
  }

  const openTurn = await getOpenTurn();

  await prisma.$transaction(async (tx) => {
    // The cap is enforced as a conditional update, the way the old ⬢ line was:
    // the write IS the check, so two tabs drawing the last of the line cannot
    // both succeed.
    const { count } = await tx.depot.updateMany({
      where: draw
        ? { id: 1, debtObols: { lte: (depot.creditCapObols ?? 0) - amount } }
        : { id: 1, debtObols: { gte: amount } },
      data: { debtObols: draw ? { increment: amount } : { decrement: amount } },
    });
    if (count === 0) throw new UserError("The line moved while you were drawing. Try again. ‡");

    const moved = await bumpAccount(tx, draw ? amount : -amount);
    const debtAfter = (depot.debtObols ?? 0) + (draw ? amount : -amount);

    const effect = {
      direction: draw ? "DRAW" : "REPAY",
      amount,
      debtBefore: depot.debtObols ?? 0,
      debtAfter,
      balanceAfter: moved.after,
    };
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
  return { direction: draw ? "DRAW" : "REPAY", amount };
}

// ─────────────────────────────────────────────────────────────────────────
// The station itself
// ─────────────────────────────────────────────────────────────────────────

// The power switch. The one action that does NOT require power, for the
// obvious reason.
async function depotGeneratorImpl({ on, reason: rawReason }) {
  const { session, character, depot } = await requireLicensedMerchant({ needsPower: false });
  const reason = requireReason(rawReason);

  const wanted = Boolean(on);
  if (wanted && (depot.generatorFuel ?? 0) <= 0) {
    throw new UserError("It turns over and dies. There's nothing in the tank. ‡");
  }

  const openTurn = await getOpenTurn();

  await prisma.$transaction(async (tx) => {
    await tx.depot.update({ where: { id: 1 }, data: { generatorOn: wanted } });
    await logRequest(tx, {
      actorDiscordUserId: session.discordUserId,
      actionType: wanted ? "depot_generator_on" : "depot_generator_off",
      targetCharacterId: character.id,
      reason,
      details: { on: wanted, fuel: depot.generatorFuel ?? 0, turn: openTurn?.number ?? null },
    });
  });

  revalidateAll();
  return { on: wanted };
}

// Shovelling fuel in. Coal is what it wants; saltpeter burns worse and is
// there for the night the coal ran out.
async function depotRefuelImpl({ slug: rawSlug, quantity: rawQuantity, reason: rawReason }) {
  const { session, character, depot } = await requireLicensedMerchant({ needsPower: false });
  const reason = requireReason(rawReason);

  const slug = rawSlug === SALTPETER_SLUG ? SALTPETER_SLUG : COAL_SLUG;
  const quantity = normalizeQuantity(rawQuantity);
  if (quantity == null) throw new UserError("That isn't a quantity. ‡");

  const fuelTag = await prisma.tag.findUnique({ where: { slug } });
  if (!fuelTag) throw new UserError("That fuel isn't in the catalog yet. ‡");

  const held = await prisma.characterTag.findUnique({
    where: { characterId_tagId: { characterId: character.id, tagId: fuelTag.id } },
  });
  if ((held?.quantity ?? 0) < quantity) {
    throw new UserError(`You're carrying ${held?.quantity ?? 0} ${fuelTag.name}. ‡`);
  }

  const perUnit = slug === SALTPETER_SLUG ? (depot.saltpeterFuel ?? 0) : (depot.coalFuel ?? 0);
  const openTurn = await getOpenTurn();

  let moved;
  await prisma.$transaction(async (tx) => {
    await dropCharacterTag(tx, character.id, fuelTag.id, quantity);
    // Clamped at the tank's size inside bumpFuel, so overfilling wastes the
    // surplus rather than banking it — `delta` is what actually went in.
    moved = await bumpFuel(tx, perUnit * quantity);

    const effect = {
      slug,
      tagName: fuelTag.name,
      quantity,
      perUnit,
      fuelBefore: moved.before,
      fuelAfter: moved.after,
      wasted: perUnit * quantity - moved.delta,
    };
    await createRequest(tx, {
      characterId: character.id,
      turnId: openTurn?.id ?? null,
      type: "DEPOT_REFUEL",
      reason,
      payload: { slug, quantity },
      effect,
    });
    await logRequest(tx, {
      actorDiscordUserId: session.discordUserId,
      actionType: "request_depot_refuel",
      targetCharacterId: character.id,
      reason,
      details: effect,
    });
  });

  await afterInventoryChange(character.id);
  revalidateAll();
  return { fuelAfter: moved?.after ?? 0, wasted: perUnit * quantity - (moved?.delta ?? 0) };
}

// Arming the gun. The confirm the client shows is a courtesy; this is the
// gate. Note what is NOT checked: whether the Merchant is currently wearing
// his own face. Arming it while concealed is a legal, fatal thing to do, and
// the UI says so in as many words before you press it.
async function depotTurretImpl({ armed, reason: rawReason }) {
  const { session, character, depot } = await requireLicensedMerchant();
  const reason = requireReason(rawReason);

  const wanted = Boolean(armed);
  const openTurn = await getOpenTurn();

  await prisma.$transaction(async (tx) => {
    await tx.depot.update({ where: { id: 1 }, data: { turretArmed: wanted } });
    await logRequest(tx, {
      actorDiscordUserId: session.discordUserId,
      actionType: wanted ? "depot_turret_armed" : "depot_turret_disarmed",
      targetCharacterId: character.id,
      reason,
      details: { armed: wanted, face: depot.merchantFace ?? "", turn: openTurn?.number ?? null },
    });
  });

  revalidateAll();
  return { armed: wanted };
}

export const depotOrder = guarded(depotOrderImpl);
export const depotCallShuttle = guarded(depotCallShuttleImpl);
export const depotSendShuttle = guarded(depotSendShuttleImpl);
export const openCrate = guarded(openCrateImpl);
export const depotAtm = guarded(depotAtmImpl);
export const depotCredit = guarded(depotCreditImpl);
export const depotGenerator = guarded(depotGeneratorImpl);
export const depotRefuel = guarded(depotRefuelImpl);
export const depotTurret = guarded(depotTurretImpl);
