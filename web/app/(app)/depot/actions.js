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
  bumpFuel,
  depotPowered,
  creditAvailableObols,
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
import { addToStack, dropCharacterTag, addToRoomStack, dropRoomTag, moveResources } from "@/lib/requestEffects";
import { UserError, guarded } from "@/lib/actionResult";
import { postMessage } from "@lifeweb/db/lib/discordRest";
import { ambientLine } from "@lifeweb/db/lib/ambientLine";
import { SHUTTLE_LANDED_LINE, SHUTTLE_DEPARTED_LINE } from "@lifeweb/db/lib/depotPass";

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
// A line the room witnesses, spoken into the Depot's Location channel.
//
// Best-effort and never inside the transaction: a Discord outage must not roll
// back a shuttle that really did land. `signed` rides with the line because
// the two shuttle lines are Bascinet's own words and must not be marked with a
// ‡ — see db/lib/ambientLine.js.
async function speakAtDepot(line) {
  const location = await prisma.location
    .findUnique({ where: { slug: DEPOT_LOCATION_SLUG }, select: { discordChannelId: true } })
    .catch(() => null);
  if (!location?.discordChannelId) return;
  await postMessage(
    location.discordChannelId,
    ambientLine(line.text, [], { signed: line.signed }),
  ).catch((err) => console.error("Depot ambient line failed:", err));
}

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
    // A non-stackable ware can only ever be held once (CharacterTag is unique
    // on character+tag), so ordering two would charge for two and deliver one
    // when the crate is opened. Refused here rather than silently clamped —
    // 182 ⬢ quietly vanishing is worse than being told no.
    if (!tag.stackable && quantity > 1) {
      throw new UserError(`The station will not ship more than one ${tag.name} — you can only ever carry one. ‡`);
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

  // The catalog prices in ⬢ and an obol is one ⬢, so the cart total IS the
  // price. Nothing converts and nothing rounds. See db/lib/depotState.js.
  const total = totalResources;
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
        // NEVER null. A null clock made both timers read "landed this turn"
        // forever: send-up stayed inside its cooldown, the auto-departure
        // never fired, and re-calling was refused because the state was not
        // AWAY — a permanently docked shuttle only SQL could free.
        // getOpenTurn() is legitimately null between advances, so 0 is the
        // floor: an already-elapsed turn number, which frees it immediately.
        shuttleTurn: openTurn?.number ?? 0,
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

  await speakAtDepot(SHUTTLE_LANDED_LINE);
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
  const landed = depot.shuttleTurn ?? 0;
  const cooldown = depot.shuttleCooldown ?? 0;
  if (openTurn && openTurn.number - landed < cooldown) {
    throw new UserError("It only just landed. Give the crew a turn to work. ‡");
  }

  const room = await landingPad();

  // A crate going back up is worth what is inside it, not nothing — otherwise
  // an unopened shipment would be destroyed by returning it, which reads as a
  // bug however you explain it.
  let goodsResources = 0;
  const soldTags = [];

  // A crate has no sellablePrice of its own — it is a box. Sending one back up
  // unopened has to pay for what is INSIDE it, or returning an unopened
  // shipment would silently annihilate it. Contents are priced off the live
  // catalog here rather than off the crate, since the crate only stores names
  // and counts.
  const crateInner = room.tags.filter((rt) => Array.isArray(rt.tag.crateContents));
  const innerIds = [...new Set(crateInner.flatMap((rt) => rt.tag.crateContents.map((c) => c.tagId)))];
  const innerPrice = new Map(
    innerIds.length
      ? (
          await prisma.tag.findMany({
            where: { id: { in: innerIds } },
            select: { id: true, sellablePrice: true },
          })
        ).map((t) => [t.id, t.sellablePrice ?? 0])
      : [],
  );

  for (const rt of room.tags) {
    const contents = Array.isArray(rt.tag.crateContents) ? rt.tag.crateContents : null;
    const unit = contents
      ? contents.reduce((sum, c) => sum + (innerPrice.get(c.tagId) ?? 0) * c.quantity, 0)
      : (rt.tag.sellablePrice ?? 0);
    if (unit > 0) goodsResources += unit * rt.quantity;
    soldTags.push({
      tagId: rt.tagId,
      name: rt.tag.name,
      quantity: rt.quantity,
      unitPrice: unit,
      crate: Boolean(contents),
    });
  }
  // Loose ⬢ in the stash stay where they are. The Bank's ⬢ counter is
  // marginless and always open, so there is no reason to move them through the
  // shuttle instead. The shuttle sells GOODS.
  const payout = goodsResources;
  const resourcesSpent = 0;

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

  await speakAtDepot(SHUTTLE_DEPARTED_LINE);
  revalidateAll();
  return { payout, sold: soldTags.length };
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
  // Contents that could not land — a non-stackable ware already held. Recorded
  // on the effect so the Ledger and a GM can see what the crate really gave.
  const skipped = [];
  await prisma.$transaction(async (tx) => {
    for (const line of contents) {
      const tag = byId.get(line.tagId);
      // A ware pruned out of the catalog between landing and opening is gone.
      // Skipping it beats throwing: the rest of the crate should still open.
      if (!tag) continue;
      // addToStack returns the existing row untouched for a non-stackable tag
      // already held, so what the Ledger records has to be what actually
      // landed — not what the crate said it held. Otherwise a Merchant who
      // already owns an ML-23 opens a crate, receives nothing, and is told he
      // received a pistol.
      const before = await tx.characterTag.findUnique({
        where: { characterId_tagId: { characterId: character.id, tagId: tag.id } },
      });
      await addToStack(tx, character.id, tag.id, line.quantity, {
        source: "EVENT",
        stackable: tag.stackable,
        expiresTurn: await expiryForGrant(tx, tag, openTurn, {
          characterId: character.id,
          where: "openCrate",
        }),
      });
      const landed = tag.stackable ? line.quantity : before ? 0 : 1;
      if (landed > 0) granted.push({ tagId: tag.id, name: tag.name, quantity: landed });
      else skipped.push({ tagId: tag.id, name: tag.name, reason: "already held, and only one can be carried" });
    }

    await dropCharacterTag(tx, character.id, crate.id, null);

    const effect = { crateTagId: crate.id, crateName: crate.name, sealed: crate.sealedShipping, granted, skipped };
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
  return { granted, skipped };
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

// ⬢ across the counter, both directions, with no spread.
//
// This is the Merchant's own float: he takes Resources off Ravenheart all day
// and needs them as money, and he needs to put money back into Resources to
// pay for things priced in ⬢. Charging himself a spread to use his own till
// would be nonsense, so this counter is deliberately marginless.
//
// One obol is one ⬢, so what this really does is change the FORM of a value
// rather than its amount: a number on a character sheet becomes coins that can
// be carried, handed over and stolen, and back again. Asking in ⬢ instead would mean flooring somewhere.
async function depotExchangeImpl({ direction: rawDirection, obols: rawObols, reason: rawReason }) {
  const { session, character, depot } = await requireLicensedMerchant();
  const reason = requireReason(rawReason);

  const buying = rawDirection === "BUY_RESOURCES";
  const obols = Number(rawObols);
  if (!Number.isInteger(obols) || obols < 1) throw new UserError("That isn't an amount. ‡");

  const resources = obols;

  if (buying && (depot.accountObols ?? 0) < obols) {
    throw new UserError(`The account holds ${depot.accountObols ?? 0} ¢. ‡`);
  }
  if (!buying && character.resources < resources) {
    throw new UserError(`That's ${resources} ⬢ and you have ${character.resources}. ‡`);
  }

  const openTurn = await getOpenTurn();

  await prisma.$transaction(async (tx) => {
    // The station side first when buying, so a concurrent spend that empties
    // the account fails BEFORE the ⬢ are handed over. moveResources is itself
    // a conditional update, so the selling direction is guarded the same way.
    const moved = await bumpAccount(tx, buying ? -obols : obols);
    if (Math.abs(moved.delta) < obols) {
      throw new UserError("The account moved while you were counting. Try again. ‡");
    }
    await moveResources(tx, { kind: "character", id: character.id }, buying ? resources : -resources);

    const effect = {
      direction: buying ? "BUY_RESOURCES" : "SELL_RESOURCES",
      obols,
      resources,
      balanceBefore: moved.before,
      balanceAfter: moved.after,
    };
    await createRequest(tx, {
      characterId: character.id,
      turnId: openTurn?.id ?? null,
      type: "DEPOT_EXCHANGE",
      reason,
      payload: { direction: effect.direction, obols },
      effect,
    });
    await logRequest(tx, {
      actorDiscordUserId: session.discordUserId,
      actionType: "request_depot_exchange",
      targetCharacterId: character.id,
      reason,
      details: effect,
    });
  });

  revalidateAll();
  return { direction: buying ? "BUY_RESOURCES" : "SELL_RESOURCES", obols, resources };
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

  // Arming with no face on file is a one-click suicide with a GM-only cure:
  // the gun would fire on everyone including the Merchant, and merchantFace is
  // writable from /gm/dev alone. Worse, disarming requires standing in the
  // Depot — and walking in rolls the turret on you first. Refused outright
  // rather than warned about. Disarming is always allowed.
  if (wanted && !String(depot.merchantFace ?? "").trim()) {
    throw new UserError(
      "There is no face on file, so it would fire on you too. A GM has to set that first. ‡",
    );
  }

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
export const depotExchange = guarded(depotExchangeImpl);
export const depotGenerator = guarded(depotGeneratorImpl);
export const depotRefuel = guarded(depotRefuelImpl);
export const depotTurret = guarded(depotTurretImpl);
