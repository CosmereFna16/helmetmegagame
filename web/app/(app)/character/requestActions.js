"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { TURNS_PATH } from "@/lib/routes";
import { redirect } from "next/navigation";
import { prisma, isDynastyHead, isDynastyMember } from "@lifeweb/db";
import { resolveParty as dbResolveParty } from "@lifeweb/db/lib/parties";
import { applyTransfer, InsufficientResourcesError } from "@lifeweb/db/lib/resourceTransfer";
import { auth } from "@/lib/auth";
import { getOpenTurn } from "@/lib/turn";
import {
  createRequest,
  logRequest,
  requireReason,
  isDeadSimple,
  DEAD_SIMPLE_PER_TURN,
} from "@/lib/requests";
import { UserError, guarded } from "@/lib/actionResult";
import { expiryFor, describeTurn } from "@/lib/turnFormat";
import { isTradeable, fastTravelCapacity, addRequirementSatisfied } from "@/lib/tagRequests";
import {
  tagsById as buildTagsById,
  exclusiveConflict,
  chainSiblingsToRemove,
  heldHigherTiers,
} from "@/lib/characterCreation";
import {
  addToStack,
  creditResources,
  debitResources,
  dropCharacterTag,
  formatStack,
  grantTagSlugs,
  moveResources,
} from "@/lib/requestEffects";
import {
  HEALABLE_CATEGORY,
  HEAL_SKILL_SLUG,
  buildSkillAncestry,
  healCost,
  isHealable,
  missingSkillsFor,
  satisfiedSkillIds,
} from "@/lib/healRequests";
import { canReachParty, canReachSilo, outOfReachMessage } from "@/lib/transferReach";
import { resolveConsumeGrants, heldSlugsOf } from "@/lib/consumeGrants";
import { recordArchiveEvent } from "@/lib/archive";
import {
  syncCharacterNarrowcastAccess,
  syncCharacterNickname,
  ensureCharacterRole,
  syncCharacterZoneRole,
  removeCursedRole,
  sendDm,
} from "@/lib/discordGuild";
import { applyPendingInvites } from "@lifeweb/db/lib/threadInvites";
import { rollTagChain } from "@lifeweb/db/lib/tagShapes";
import { postMessage } from "@lifeweb/db/lib/discordRest";
import { notifyCharacter } from "@/lib/notifyCharacter";
import { rollCaving } from "@lifeweb/db/lib/cavingPass";
import { evaluateDesireCatalog, slotStates } from "@lifeweb/db/lib/desireGates";
import { INCAPACITATING_SLUGS, FINISHABLE_SLUGS } from "@lifeweb/db/lib/incapacitation";
import { ATE_MEAL_SLUG, DISAPPOINTED_SLUG } from "@lifeweb/db/lib/constants";
import { NAME_LIMITS, formatCharacterName, formatBareName, normalizeEarnedHonorific } from "@/lib/characterName";
import { propagateDynastyLastName } from "@/lib/dynasty";

// Every player-initiated change that is applied immediately and reviewed
// afterwards. Each action: authenticate, re-validate everything the client
// sent (a server action is a public endpoint), then apply the effect and
// write the Request + AuditLog rows in ONE transaction, so a request can
// never exist without its effect or vice versa.

// The one generic rejection text a hidden-catalog template and a
// nonexistent/retired one BOTH answer with — a differentiated message would
// itself be the oracle the hidden rule exists to prevent (DESIRES §5).
const DESIRE_NOT_AVAILABLE = "That Desire isn't available to you.";

async function requireCharacter() {
  const session = await auth();
  if (!session?.discordUserId) redirect("/");
  const character = await prisma.character.findFirst({
    where: { discordUserId: session.discordUserId, status: "ALIVE" },
    // role.slug only, so changeNameRequestImpl can apply the same dynasty
    // last-name lock every other writer of Character.name already enforces.
    include: { tags: { include: { tag: true } }, role: { select: { slug: true } } },
  });
  if (!character) redirect("/character");
  return { session, character };
}

function revalidateAll() {
  revalidatePath("/character");
  revalidatePath("/faction");
  revalidatePath(TURNS_PATH, "page");
  revalidatePath("/gm/audit");
}

function parseCount(raw, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const n = Number.parseInt(raw ?? "", 10);
  if (!Number.isFinite(n) || n < min || n > max) return null;
  return n;
}

// --- Resources --------------------------------------------------------

// "character:<id>" / "faction:<id>" on both ends. Per the design call, the
// SOURCE may be any faction silo or any living player — a player can pull
// resources to themselves and justify it in the reason, and a GM undoes it if
// that was a lie. That's the whole bet of the Requests system.
//
// What the source may NOT be is somewhere else: see web/lib/transferReach.js.
// The bet is that you'll explain yourself afterwards, not that you can do it
// from across the map. The zone comes back on every party so the caller can
// ask.
//
// Lives in db/lib/parties.js now, beside applyTransfer, so the turn-end push
// and every GM transfer surface resolve the exact same key this request
// type does. Re-exported as a local wrapper (prisma bound) since every call
// site here already reads `resolveParty(key, opts)`.
function resolveParty(key, opts) {
  return dbResolveParty(prisma, key, opts);
}

async function transferResourcesRequestImpl({ fromKey, toKey, amount: rawAmount, direction: rawDirection, reason: rawReason }) {
  const { session, character } = await requireCharacter();
  const reason = requireReason(rawReason);
  const direction = rawDirection === "LOOT" ? "LOOT" : "SEND";
  const isLoot = direction === "LOOT";

  const amount = parseCount(rawAmount, { min: 1 });
  if (amount == null) throw new UserError("Amount must be a positive whole number.");

  // Looting a corpse: the source has to be a DEAD character in the same zone,
  // and the recipient is the initiator. Every other constraint (reach,
  // balance-covers-amount, no-self-transfer) stays.
  const [from, to] = await Promise.all([
    resolveParty(fromKey, { allowDead: isLoot }),
    resolveParty(toKey),
  ]);
  if (!from) throw new UserError("Unknown source.");
  if (!to) throw new UserError("Unknown recipient.");
  if (from.kind === to.kind && from.id === to.id) throw new UserError("Source and recipient are the same.");

  if (isLoot) {
    if (from.kind !== "character" || from.status !== "DEAD") {
      throw new UserError("You can only loot ⬢ from a corpse.");
    }
    // A buried body is out of the world — see BURY_CHARACTER. Rejected here
    // rather than filtered out of resolveParty so the wording explains itself.
    if (from.buriedAt) throw new UserError("They're already in the ground.");
    if (!character.zoneId || from.zoneId !== character.zoneId) {
      throw new UserError("They aren't here.");
    }
    if (to.kind !== "character" || to.id !== character.id) {
      throw new UserError("You can only loot ⬢ into your own pocket.");
    }
  }

  // Both ends have to be somewhere you can stand. Checked here rather than in
  // resolveParty because heal's payer rules differ slightly, and checked on
  // submit rather than by filtering the dropdowns: a range-filtered party menu
  // would be a free "who is standing in my zone" scouting tool, which is a
  // worse leak than the friction it saves.
  //
  // Loot has its own reach check above (same zone as the corpse), so the
  // general reach gate would only add a false-positive dead-people-fail
  // branch — skip it for that direction.
  if (!isLoot) {
    for (const party of [from, to]) {
      if (!(await canReachParty(character, party))) {
        throw new UserError(outOfReachMessage(party, party.zoneName));
      }
    }
  }

  if (amount > from.balance) throw new UserError(`${from.name} only has ${from.balance} ⬢.`);

  const openTurn = await getOpenTurn();
  const ledger = {
    actorDiscordUserId: session.discordUserId,
    actorCharacterId: character.id,
    actorName: character.name,
    turnNumber: openTurn?.number ?? null,
    turnPhase: openTurn?.phase ?? null,
    note: reason,
  };

  // Ordered by (kind, id), not by which side is the sender. Two simultaneous
  // transfers between the same pair in opposite directions used to take their
  // row locks in opposite orders — A then B for one, B then A for the other —
  // which is a textbook Postgres deadlock, resolved by the server killing one
  // of them and surfacing it to that player as a generic failure. A total
  // order over the participants means both transactions queue instead.
  //
  // The ledger still records the real direction. applyTransfer (db/lib/
  // resourceTransfer.js) does the sorting, the ordered legs, and the
  // SiloTransaction rows — the same primitive the turn desk's staged
  // transfers and every GM transfer surface use.
  await prisma.$transaction(async (tx) => {
    // applyTransfer refuses a debit the balance no longer covers, which
    // aborts the whole transaction. The `amount > from.balance` check above
    // is the friendly message; this is the one that two simultaneous
    // transfers cannot both pass. It throws InsufficientResourcesError (a
    // bare Error, from db/lib) rather than UserError — guarded() only knows
    // UserError, and Next redacts anything else into an opaque digest, so
    // this is the one place that translation has to happen by hand.
    try {
      await applyTransfer(tx, { from, to, amount, ledger });
    } catch (err) {
      if (!(err instanceof InsufficientResourcesError)) throw err;
      throw new UserError(err.message);
    }

    const effect = {
      amount,
      from: { kind: from.kind, id: from.id, name: from.name },
      to: { kind: to.kind, id: to.id, name: to.name },
      direction,
    };
    await createRequest(tx, {
      characterId: character.id,
      turnId: openTurn?.id ?? null,
      type: "TRANSFER_RESOURCES",
      reason,
      payload: { fromKey, toKey, amount, direction },
      effect,
    });
    await logRequest(tx, {
      actorDiscordUserId: session.discordUserId,
      actionType: isLoot ? "request_loot_resources" : "request_transfer_resources",
      targetCharacterId: isLoot ? from.id : to.kind === "character" ? to.id : character.id,
      reason,
      details: effect,
    });
  });

  // Only a character on the receiving end learns anything — a faction silo
  // has no one person to DM, and loot's "recipient" is the initiator, who
  // already knows what they just did.
  if (isLoot) {
    if (from.kind === "character") notifyCharacter(from, `You were looted for ${amount} ⬢.`);
  } else if (to.kind === "character") {
    notifyCharacter(to, `You were given ${amount} ⬢.`);
  }

  revalidateAll();
  return {};
}

// --- Tags -------------------------------------------------------------

// Dead Simple units a character has already filed this turn (web/lib/requests.js
// DEAD_SIMPLE_PER_TURN). UNDONE excluded: an undone ADD_TAG took its tag back
// off the sheet (web/lib/requestEffects.js), so it gives the quota back too.
// EDITED still counts — the item was made, a GM only adjusted it. `db` is
// prisma or a transaction client.
async function deadSimpleUnitsThisTurn(db, characterId, turnId) {
  const filed = await db.request.findMany({
    where: { characterId, turnId, type: "ADD_TAG", status: { not: "UNDONE" } },
    select: { payload: true },
  });
  const filedTagIds = [...new Set(filed.map((r) => r.payload?.tagId).filter(Boolean))];
  // One query for the recipes behind the ids already filed — a request's
  // payload records the tag, not whether it was Dead Simple at the time.
  const filedTags = filedTagIds.length
    ? await db.tag.findMany({
        where: { id: { in: filedTagIds } },
        select: { id: true, requirementTurns: true, requirementSkills: { select: { slug: true } } },
      })
    : [];
  const deadSimpleIds = new Set(filedTags.filter(isDeadSimple).map((t) => t.id));
  return filed.reduce((sum, r) => {
    if (!deadSimpleIds.has(r.payload?.tagId)) return sum;
    return sum + (Number(r.payload?.quantity) || 0);
  }, 0);
}

async function addTagRequestImpl({
  tagId,
  quantity: rawQuantity,
  resourcesSpent: rawSpend,
  reason: rawReason,
}) {
  const { session, character } = await requireCharacter();
  const reason = requireReason(rawReason);

  const resourcesSpent = parseCount(rawSpend, { min: 0 }) ?? 0;
  if (resourcesSpent > character.resources) throw new UserError("You don't have that many ⬢.");

  const tag = await prisma.tag.findUnique({
    where: { id: tagId },
    include: {
      group: { select: { requiredTagId: true } },
      // `slug` is how isDeadSimple() recognises the bottom rung of the
      // smithing ladder for the per-turn cap below. The skills are not a
      // gate here — Add Tag is honor-system (TAGS.md §3b).
      requirementSkills: { select: { slug: true } },
    },
  });
  if (!tag) throw new UserError("Unknown tag.");
  // Mirrors addableTags() in web/lib/tagRequests.js — re-checked here because
  // the client's filtered list is only advisory. The purchasable branch also
  // requires purchasableAfterStart (a launch-day-only pick can't arrive as a
  // request); craftables bypass it deliberately, their gate being the
  // requirement block.
  if (!(tag.purchasable && tag.purchasableAfterStart) && !tag.craftable) {
    throw new UserError("That tag can't be added this way.");
  }

  // The Add Tag menu's own gate, re-checked here because the client's
  // filtering is decorative — a hand-posted request would otherwise walk
  // straight past it. Two routes, either suffices: buy it (purchasable +
  // requiredTag) or make it (any craftable — the recipe's skills are advice,
  // not a gate). The group gate (hides a whole category — Demoness, Bacchus)
  // applies to both routes unconditionally. See
  // tagRequests.js#addRequirementSatisfied.
  //
  // The whole catalog's ids/parents come down (~80 rows) so a chain walk
  // never dead-ends on an ancestor the character doesn't hold, same reason
  // createCharacter does it.
  // `name`, `requiredTagId` and `exclusive` ride along for the exclusivity
  // check below — exclusiveConflict() reads all three off the held row.
  const chainRows = await prisma.tag.findMany({
    select: {
      id: true,
      name: true,
      parentTagId: true,
      requiredTagId: true,
      exclusive: true,
      groupId: true,
      removable: true,
    },
  });
  const chainById = buildTagsById(chainRows);
  const heldIds = character.tags.map((ct) => ct.tagId);
  if (!addRequirementSatisfied(tag, chainById, heldIds)) {
    throw new UserError("You're missing a prerequisite for that tag.");
  }

  // One exclusive tag at a time (the Beliefs) — the same rule the point-buy
  // menu and the store enforce, re-checked here because this menu is the third
  // door onto the catalog.
  const conflict = exclusiveConflict(tag, heldIds, chainById);
  if (conflict) {
    throw new UserError(
      conflict.removable
        ? `You already hold ${conflict.name}; drop it first to take ${tag.name}.`
        : `${tag.name} can't be held with ${conflict.name}.`,
    );
  }

  // A chain replaces upward and never re-opens downward — a tier below one
  // already held is a downgrade, not an addition (same guard as the store).
  if (heldHigherTiers(tag, chainById, heldIds).length > 0) {
    throw new UserError(`You already hold a higher tier of ${tag.name}'s chain.`);
  }

  // A stackable tag adds to what's already there; anything else is still
  // one-or-nothing. Both checks are server-side because the client's
  // quantity field is advisory too.
  const quantity = tag.stackable ? parseCount(rawQuantity, { min: 1, max: 99 }) ?? 1 : 1;
  if (!tag.stackable && character.tags.some((ct) => ct.tagId === tag.id)) {
    throw new UserError("You already have that tag.");
  }

  const openTurn = await getOpenTurn();

  // Dead Simple recipes cost 0 turns, so nothing else rations them — a player
  // could file requests all turn and end it with twenty work knives. At most
  // DEAD_SIMPLE_PER_TURN Dead Simple UNITS per character per turn, summed over
  // every ADD_TAG request already filed this turn plus this one. Units rather
  // than requests because these tags are stackable and one request can carry
  // any quantity. See docs/systemdocs/SMITHING.md §2.
  //
  // Counted only when THIS tag is Dead Simple: everything else on the ladder
  // costs turns, which is its own limit. Requests with no open turn (turnId
  // null) are outside any turn and so outside the cap.
  // Checked twice: here, outside the transaction, so a plain over-cap request
  // fails fast with a readable message — and again INSIDE the transaction
  // below behind a row lock on the character, because two Dead Simple
  // requests fired in the same instant would otherwise both read the same
  // count and both pass (they spend no turns, so nothing else serialises
  // them).
  const deadSimple = Boolean(openTurn && isDeadSimple(tag));
  if (deadSimple) {
    const already = await deadSimpleUnitsThisTurn(prisma, character.id, openTurn.id);
    if (already + quantity > DEAD_SIMPLE_PER_TURN) {
      throw new UserError(
        `You can only make ${DEAD_SIMPLE_PER_TURN} Dead Simple items per turn (${already} already this turn).`,
      );
    }
  }

  // A chain replaces: adding a higher tier takes the held lower tier off the
  // sheet in the same transaction (TAGS.md §3). Snapshotted onto the effect
  // so Undo — and the GM's remove-tag edit — restore exactly what came off.
  const replaced = character.tags
    .filter((ct) => chainSiblingsToRemove(tag, chainById, heldIds).includes(ct.tagId))
    .map((ct) => ({
      tagId: ct.tagId,
      tagName: ct.tag?.name ?? null,
      source: ct.source,
      expiresTurn: ct.expiresTurn,
      quantity: ct.quantity,
    }));

  await prisma.$transaction(async (tx) => {
    if (deadSimple) {
      // Serialise concurrent Dead Simple requests from one character: the
      // lock holds until commit, so the recount sees the other's row.
      await tx.$queryRaw`SELECT "id" FROM "Character" WHERE "id" = ${character.id} FOR UPDATE`;
      const already = await deadSimpleUnitsThisTurn(tx, character.id, openTurn.id);
      if (already + quantity > DEAD_SIMPLE_PER_TURN) {
        throw new UserError(
          `You can only make ${DEAD_SIMPLE_PER_TURN} Dead Simple items per turn (${already} already this turn).`,
        );
      }
    }
    for (const snapshot of replaced) {
      await dropCharacterTag(tx, character.id, snapshot.tagId);
    }
    await addToStack(tx, character.id, tag.id, quantity, {
      source: "EVENT",
      // A timed tag has to arrive already stamped or it never expires:
      // resolveNeeds()'s sweep matches on expiresTurn and nothing backfills
      // it. This used to pass a hard null with openTurn already in scope,
      // which is why a Paralyzed could sit on a sheet forever while its
      // tooltip promised "Lasts 1 turn". Same stamp createCharacter and the
      // Hunger pass apply.
      expiresTurn: expiryFor(tag, openTurn),
      stackable: tag.stackable,
    });
    if (resourcesSpent) {
      await moveResources(tx, { kind: "character", id: character.id, name: character.name }, -resourcesSpent);
    }
    await createRequest(tx, {
      characterId: character.id,
      turnId: openTurn?.id ?? null,
      type: "ADD_TAG",
      reason,
      payload: { tagId: tag.id, quantity, resourcesSpent },
      // `replaced` only when an upgrade displaced something — older effects
      // keep their exact shape, and the handlers treat absence as [].
      effect: {
        tagId: tag.id,
        tagName: tag.name,
        quantity,
        resourcesSpent,
        ...(replaced.length ? { replaced } : {}),
      },
    });
    await logRequest(tx, {
      actorDiscordUserId: session.discordUserId,
      actionType: "request_add_tag",
      targetCharacterId: character.id,
      reason,
      details: { tagId: tag.id, tagName: tag.name, quantity, resourcesSpent },
    });
  });

  // Tags gate #watch access, so a grant can change narrowcast visibility.
  await syncCharacterNarrowcastAccess(character.id).catch(() => {});
  revalidateAll();
  return {};
}

async function removeTagRequestImpl({
  tagId,
  quantity: rawQuantity,
  resourcesSpent: rawSpend,
  reason: rawReason,
}) {
  const { session, character } = await requireCharacter();
  const reason = requireReason(rawReason);

  const resourcesSpent = parseCount(rawSpend, { min: 0 }) ?? 0;
  if (resourcesSpent > character.resources) throw new UserError("You don't have that many ⬢.");

  const held = character.tags.find((ct) => ct.tagId === tagId);
  if (!held) throw new UserError("You don't have that tag.");
  if (!held.tag.removable) throw new UserError("That tag can't be removed this way.");

  const quantity = held.tag.stackable
    ? parseCount(rawQuantity, { min: 1, max: held.quantity }) ?? 1
    : held.quantity;

  const openTurn = await getOpenTurn();
  // Snapshot before deleting — Undo restores the original source, expiry and
  // count, not a fresh grant.
  const restore = {
    tagId: held.tagId,
    source: held.source,
    expiresTurn: held.expiresTurn,
    quantity,
  };

  // The aftermath (Tag.removesInto): shedding an affliction through play
  // leaves its treated form behind — Broken Bone comes off as Splinted. The
  // oneOf picks are rolled up front so the transaction commits exactly what
  // the snapshot records. Fires once per request regardless of quantity.
  const aftermathSlugs = rollTagChain(held.tag.removesInto);

  let granted = [];
  await prisma.$transaction(async (tx) => {
    await dropCharacterTag(tx, character.id, tagId, quantity);
    granted = await grantTagSlugs(tx, character.id, aftermathSlugs, openTurn?.number ?? null);
    if (resourcesSpent) {
      await moveResources(tx, { kind: "character", id: character.id, name: character.name }, -resourcesSpent);
    }
    await createRequest(tx, {
      characterId: character.id,
      turnId: openTurn?.id ?? null,
      type: "REMOVE_TAG",
      reason,
      payload: { tagId, quantity, resourcesSpent },
      effect: { tagId, tagName: held.tag.name, quantity, resourcesSpent, restore, granted },
    });
    await logRequest(tx, {
      actorDiscordUserId: session.discordUserId,
      actionType: "request_remove_tag",
      targetCharacterId: character.id,
      reason,
      details: {
        tagId,
        tagName: held.tag.name,
        quantity,
        resourcesSpent,
        granted: granted.map((g) => g.tagName),
      },
    });
  });

  await syncCharacterNarrowcastAccess(character.id).catch(() => {});
  revalidateAll();
  return {};
}

// Using something up: the tag comes off the sheet and whatever it declares in
// Tag.consumesInto goes on. Always exactly ONE unit, so a stack of meals feeds
// the character several times — there is deliberately no quantity field
// anywhere in this path.
//
// No resource cost either: a meal already cost ⬢ to make, so charging again
// here would be the same meal paid for twice. (The Hunger pass no longer bills
// upkeep on a turn you ate — see db/lib/hungerPass.js.)
//
// A grant may be conditional on what the character already holds — Fine Meal
// cheers an ordinary person but not a noble — which is why the slug list runs
// through resolveConsumeGrants rather than going straight to grantTagSlugs.
async function consumeTagRequestImpl({ tagId, reason: rawReason }) {
  const { session, character } = await requireCharacter();
  const reason = requireReason(rawReason);

  const held = character.tags.find((ct) => ct.tagId === tagId);
  if (!held) throw new UserError("You don't have that tag.");
  // Mirrors consumableTags() in web/lib/tagRequests.js — re-checked here
  // because the client's filtered menu is only advisory.
  if (!held.tag.consumable) throw new UserError("That tag can't be consumed.");

  const openTurn = await getOpenTurn();
  // Snapshot before consuming — Undo restores the original source and expiry,
  // and exactly the one unit this took, not the whole stack.
  const restore = {
    tagId: held.tagId,
    source: held.source,
    expiresTurn: held.expiresTurn,
    quantity: 1,
  };

  // requireCharacter() already eager-loads tags.tag, so the held slugs cost
  // no extra query. Undo needs no matching change: it reads the `granted`
  // (and `resourcesGranted`) snapshot below, never re-deriving from the
  // catalog.
  const {
    slugs: grantSlugs,
    durations: grantDurations,
    resources: resourcesGranted,
  } = resolveConsumeGrants(held.tag, heldSlugsOf(character.tags));

  // A proper meal lifts a noble's Disappointment on the spot — keyed off the
  // ate-meal grant rather than the item eaten, so anything that becomes Ate
  // Meal counts. (The turn pass in db/lib/hungerPass.js is only the backstop
  // for meals a GM granted directly.) Snapshotted like `restore` so Undo can
  // put the mope back along with the meal.
  const disappointedHeld = grantSlugs.includes(ATE_MEAL_SLUG)
    ? character.tags.find((ct) => ct.tag.slug === DISAPPOINTED_SLUG)
    : null;
  const cleared = disappointedHeld
    ? {
        tagId: disappointedHeld.tagId,
        tagName: disappointedHeld.tag.name,
        source: disappointedHeld.source,
        expiresTurn: disappointedHeld.expiresTurn,
        quantity: 1,
      }
    : null;

  await prisma.$transaction(async (tx) => {
    await dropCharacterTag(tx, character.id, tagId, 1);
    if (cleared) await dropCharacterTag(tx, character.id, cleared.tagId, 1);
    const granted = await grantTagSlugs(
      tx,
      character.id,
      grantSlugs,
      openTurn?.number ?? null,
      grantDurations,
    );
    // The Resources half — Purse and Supply Kit (see docs/systemdocs/
    // CAVING.md). Most consumables grant none, so this is a no-op for them.
    if (resourcesGranted) {
      await creditResources(tx, { kind: "character", id: character.id, name: character.name }, resourcesGranted);
    }
    await createRequest(tx, {
      characterId: character.id,
      turnId: openTurn?.id ?? null,
      type: "CONSUME_TAG",
      reason,
      payload: { tagId },
      effect: { tagId, tagName: held.tag.name, restore, granted, resourcesGranted, cleared },
    });
    await logRequest(tx, {
      actorDiscordUserId: session.discordUserId,
      actionType: "request_consume_tag",
      targetCharacterId: character.id,
      reason,
      details: {
        tagId,
        tagName: held.tag.name,
        granted: granted.map((g) => g.tagName),
        resourcesGranted,
        cleared: cleared?.tagName,
      },
    });
  });

  // Both the tag consumed and anything it became can gate #watch/#intercom.
  await syncCharacterNarrowcastAccess(character.id).catch(() => {});
  revalidateAll();
  return {};
}

// SEND is the ordinary path — the initiator hands one of their own `tradeable`
// tags to someone in the same zone. LOOT is its inverse: the counterparty is a
// corpse lying in that same zone, and the initiator pulls the item off it.
// There is still no "request a tag from a living someone" — that direction
// stays send-only, so browsing another live player's inventory is never a
// menu the game hands you.
async function transferTagRequestImpl({
  tagId,
  quantity: rawQuantity,
  toCharacterId,
  direction: rawDirection,
  reason: rawReason,
}) {
  const { session, character } = await requireCharacter();
  const reason = requireReason(rawReason);
  const direction = rawDirection === "LOOT" ? "LOOT" : "SEND";
  const isLoot = direction === "LOOT";

  if (!character.zoneId) {
    throw new UserError(
      isLoot ? "You aren't anywhere you could pick that up." : "You aren't anywhere you could hand that over.",
    );
  }
  if (toCharacterId === character.id) throw new UserError("That's you.");

  // In SEND the initiator IS the source; in LOOT the counterparty is. Both
  // roles need the eager-loaded tag row so we can size the stack, look at
  // expiry, and read `tradeable` off the catalog side.
  let source;
  if (isLoot) {
    // A corpse in the same zone. Folded into the WHERE clause the same way
    // the recipient check used to be, so a corpse that gets moved (a Revive
    // between page load and submit) fails closed and nothing is written.
    const corpse = await prisma.character.findFirst({
      where: { id: toCharacterId ?? "", status: "DEAD", buriedAt: null, zoneId: character.zoneId },
      select: {
        id: true,
        name: true,
        discordUserId: true,
        tags: {
          where: { tagId },
          select: {
            tagId: true,
            quantity: true,
            source: true,
            expiresTurn: true,
            tag: { select: { name: true, category: true, stackable: true, tradeable: true } },
          },
        },
      },
    });
    if (!corpse) throw new UserError("Nothing to loot here.");
    const corpseHeld = corpse.tags[0] ?? null;
    if (!corpseHeld) throw new UserError("They don't have that.");
    source = {
      id: corpse.id,
      name: corpse.name,
      discordUserId: corpse.discordUserId,
      tag: corpseHeld.tag,
      source: corpseHeld.source,
      expiresTurn: corpseHeld.expiresTurn,
      quantity: corpseHeld.quantity,
    };
  } else {
    const held = character.tags.find((ct) => ct.tagId === tagId);
    if (!held) throw new UserError("You don't have that tag.");
    source = {
      id: character.id,
      name: character.name,
      tag: held.tag,
      source: held.source,
      expiresTurn: held.expiresTurn,
      quantity: held.quantity,
    };
  }

  if (!isTradeable(source.tag)) {
    throw new UserError(
      isLoot
        ? "That isn't something you can take off a body."
        : "That isn't yours to hand over.",
    );
  }

  // Capped at what the source actually holds, so a hand-crafted request can't
  // mint items out of a stack that isn't there.
  const quantity = source.tag.stackable
    ? parseCount(rawQuantity, { min: 1, max: source.quantity }) ?? 1
    : source.quantity;

  // The RECIPIENT side. For SEND: pick a living character in the same zone.
  // For LOOT: the initiator receives.
  let recipient;
  if (isLoot) {
    recipient = { id: character.id, name: character.name };
  } else {
    // Same zone, same as ⬢ — handing someone a sword across the map was the
    // obvious way around the transfer gate. Folded into the WHERE clause
    // rather than done as a second read (the idiom heal uses, REQUESTS.md
    // §5c), so a recipient who walks out between page load and submit fails
    // closed and nothing is written.
    recipient = await prisma.character.findFirst({
      // `?? ""` for the same reason as resolveParty above: an omitted id
      // would otherwise be stripped from the where clause and hand the item
      // to whoever happened to be standing in the zone.
      where: { id: toCharacterId ?? "", status: "ALIVE", zoneId: character.zoneId },
      select: { id: true, name: true, discordUserId: true },
    });
    if (!recipient) throw new UserError("They aren't here.");
  }

  const openTurn = await getOpenTurn();
  const restore = { source: source.source, expiresTurn: source.expiresTurn, quantity };

  await prisma.$transaction(async (tx) => {
    await dropCharacterTag(tx, source.id, tagId, quantity);
    await addToStack(tx, recipient.id, tagId, quantity, {
      source: "EVENT",
      expiresTurn: source.expiresTurn,
      stackable: source.tag.stackable,
    });
    await createRequest(tx, {
      characterId: character.id,
      turnId: openTurn?.id ?? null,
      type: "TRANSFER_TAG",
      reason,
      payload: { tagId, quantity, toCharacterId, direction },
      // fromCharacterId / toCharacterId already carry the actual movement,
      // so the existing Undo (web/lib/requestEffects.js) reverses either
      // direction without a change. `direction` is snapshotted for the
      // adjudication panel and so a later report can tell a hand-over from
      // a lifted-off-a-corpse.
      effect: {
        tagId,
        tagName: source.tag.name,
        quantity,
        fromCharacterId: source.id,
        fromName: source.name,
        toCharacterId: recipient.id,
        toName: recipient.name,
        direction,
        restore,
      },
    });
    await logRequest(tx, {
      actorDiscordUserId: session.discordUserId,
      actionType: isLoot ? "request_loot_tag" : "request_transfer_tag",
      // For loot the "target" of the audit line is the corpse — that's who
      // the initiator acted ON, not who received the goods. Matches the
      // convention HEAL_CHARACTER uses (audit points at the patient).
      targetCharacterId: isLoot ? source.id : recipient.id,
      reason,
      details: { tagId, tagName: source.tag.name, quantity, fromName: source.name, toName: recipient.name, direction },
    });
  });

  await Promise.all([
    syncCharacterNarrowcastAccess(source.id).catch(() => {}),
    syncCharacterNarrowcastAccess(recipient.id).catch(() => {}),
  ]);

  // SEND tells the recipient what landed on their sheet; LOOT tells the
  // corpse's player what was taken off their body — nobody names the actor.
  if (isLoot) {
    notifyCharacter(source, `Something was taken off your body: ${formatStack(source.tag.name, quantity)}.`);
  } else {
    notifyCharacter(recipient, `You were handed ${formatStack(source.tag.name, quantity)}.`);
  }

  revalidateAll();
  return {};
}

// --- Healing ----------------------------------------------------------

// Treating someone else's affliction. The only request whose subject is a
// different character from the one filing it, so almost every id below is the
// TARGET's rather than the actor's — see the HEAL_CHARACTER note in
// web/lib/requestEffects.js.
//
// Three gates, all re-checked here because the dialog is advisory: the medic
// must hold a Medical skill, the patient must be standing in the medic's zone,
// and the affliction's own requirementSkills must be satisfied. The PAYER is
// deliberately ungated beyond being present — any player in the same zone or
// any faction Silo, same bet as TRANSFER_RESOURCES.
async function healCharacterRequestImpl({
  targetCharacterId,
  tagId,
  payerKey,
  reason: rawReason,
}) {
  const { session, character } = await requireCharacter();
  const reason = requireReason(rawReason);

  if (!character.zoneId) {
    throw new UserError("You aren't anywhere you could treat someone.");
  }

  // The flat catalog, for the tier chain: holding Medical (Expert) has to
  // satisfy a requirement written against Medical (Basic).
  const catalog = await prisma.tag.findMany({ select: { id: true, slug: true, parentTagId: true } });
  const ancestry = buildSkillAncestry(catalog);
  const satisfied = satisfiedSkillIds(
    character.tags.map((ct) => ct.tagId),
    ancestry,
  );
  const healSkillId = catalog.find((t) => t.slug === HEAL_SKILL_SLUG)?.id;
  if (!healSkillId || !satisfied.has(healSkillId)) {
    throw new UserError("You need Medical (Basic) to treat anyone.");
  }

  // No `id: { not: character.id }` — treating yourself is the ordinary case.
  const target = await prisma.character.findFirst({
    where: { id: targetCharacterId ?? "", status: "ALIVE", zoneId: character.zoneId },
    include: { tags: { include: { tag: { include: { requirementSkills: true } } } } },
  });
  if (!target) throw new UserError("They aren't here.");

  const held = target.tags.find((ct) => ct.tagId === tagId);
  if (!held || !isHealable(held.tag)) throw new UserError("That isn't something you can treat.");

  const missing = missingSkillsFor(held.tag, satisfied);
  if (missing.length) {
    throw new UserError(`Treating that needs ${missing.map((t) => t.name).join("/")}.`);
  }

  const payer = await resolveParty(payerKey);
  if (!payer) throw new UserError("Unknown payer.");
  // A person has to be in the zone; a Silo has to be in reach. A Silo used to
  // pay from anywhere, which became a laundering hole the moment transfers
  // grew a reach gate — bill a distant Silo for a cure and the ⬢ has moved
  // across the map without anyone carrying it.
  if (payer.kind === "character") {
    const present = await prisma.character.count({
      where: { id: payer.id, status: "ALIVE", zoneId: character.zoneId },
    });
    if (!present) throw new UserError("They aren't here to pay for it.");
  } else if (!(await canReachSilo(character, payer))) {
    throw new UserError(outOfReachMessage(payer, payer.zoneName));
  }

  // Straight off the tag, never off the client — null prices a cure at
  // nothing, which still records who stood good for it.
  const cost = healCost(held.tag);
  if (cost > payer.balance) throw new UserError(`${payer.name} only has ${payer.balance} ⬢.`);

  const openTurn = await getOpenTurn();
  const ledger = {
    actorDiscordUserId: session.discordUserId,
    actorCharacterId: character.id,
    actorName: character.name,
    turnNumber: openTurn?.number ?? null,
    turnPhase: openTurn?.phase ?? null,
    note: reason,
  };

  const effect = {
    targetCharacterId: target.id,
    targetName: target.name,
    // The panel's render() gets `effect` but not `request`, so "did they
    // treat themselves?" has to be answered here.
    selfHeal: target.id === character.id,
    tagId: held.tagId,
    tagName: held.tag.name,
    // What Undo puts back — exactly what was taken, never re-derived.
    restore: {
      tagId: held.tagId,
      source: held.source,
      expiresTurn: held.expiresTurn,
      quantity: held.quantity ?? 1,
    },
    // Named to match RequestPanel's existing SpendField/edits key, so the
    // GM panel needs no new state seeded for it.
    resourcesSpent: cost,
    payer: { kind: payer.kind, id: payer.id, name: payer.name },
    // What the catalog charged at the time, so a GM reviewing later sees the
    // price the player was actually quoted rather than today's tags.yaml.
    requirement: {
      turns: held.tag.requirementTurns,
      resources: held.tag.requirementResources,
      gambit: held.tag.requirementGambit,
      skills: held.tag.requirementSkills.map((t) => t.name),
    },
  };

  // The aftermath (Tag.removesInto), rolled up front like REMOVE_TAG's: the
  // treatment ends the danger, its treated form lingers on the PATIENT.
  const aftermathSlugs = rollTagChain(held.tag.removesInto);

  await prisma.$transaction(async (tx) => {
    // A spend, not a transfer: the cost leaves the payer and goes nowhere.
    await debitResources(tx, payer, cost, ledger);
    await dropCharacterTag(tx, target.id, held.tagId);
    effect.granted = await grantTagSlugs(tx, target.id, aftermathSlugs, openTurn?.number ?? null);
    await createRequest(tx, {
      characterId: character.id, // the medic
      turnId: openTurn?.id ?? null,
      type: "HEAL_CHARACTER",
      reason,
      payload: { targetCharacterId: target.id, tagId, payerKey },
      effect,
    });
    await logRequest(tx, {
      actorDiscordUserId: session.discordUserId,
      actionType: "request_heal_character",
      targetCharacterId: target.id, // the patient
      reason,
      details: effect,
    });
  });

  // A tag moved, and #watch/#intercom access is tag-gated.
  await syncCharacterNarrowcastAccess(target.id).catch(() => {});
  // Not for a self-heal — the medic already knows, they're the one who
  // clicked Treat.
  if (target.id !== character.id) {
    notifyCharacter(target, `Your ${held.tag.name} was treated.`);
  }
  revalidateAll();
  return { targetName: target.name, tagName: held.tag.name, cost };
}

// --- Looting a living, incapacitated target ----------------------------

// Someone dying/catatonic/paralyzed/bound in the filer's zone is a lootable
// pile the same way a corpse is, and this handles BOTH — one request takes a
// mix of tags AND ⬢ at once rather than needing a TRANSFER_TAG +
// TRANSFER_RESOURCES pair, since both come off the same helpless body in the
// same act.
//
// Folding corpses in here is what let CorpseLootPanel.js go. The older
// `TRANSFER_TAG`/`TRANSFER_RESOURCES` LOOT direction still exists and still
// works — Request rows filed under it before this change have to keep undoing
// correctly — but nothing files one any more.
async function lootCharacterRequestImpl({
  targetCharacterId,
  tagPicks: rawTagPicks,
  amount: rawAmount,
  reason: rawReason,
}) {
  const { session, character } = await requireCharacter();
  const reason = requireReason(rawReason);

  if (!character.zoneId) throw new UserError("You aren't anywhere you could do that.");

  const target = await prisma.character.findFirst({
    where: { id: targetCharacterId ?? "", status: { in: ["ALIVE", "DEAD"] }, zoneId: character.zoneId },
    include: {
      tags: {
        include: { tag: { select: { name: true, category: true, stackable: true, slug: true, tradeable: true } } },
      },
    },
  });
  if (!target) throw new UserError("They aren't here.");
  // A buried body is out of the world — see BURY_CHARACTER.
  if (target.buriedAt) throw new UserError("They're already in the ground.");

  // A corpse needs no further excuse. A living target has to be helpless —
  // going through the pockets of someone who could stop you is a Gambit, and
  // a GM adjudicates that.
  const incapacitated =
    target.status === "DEAD" || target.tags.some((ct) => INCAPACITATING_SLUGS.has(ct.tag.slug));
  if (!incapacitated) throw new UserError("They aren't in any state to be looted.");

  const picks = Array.isArray(rawTagPicks) ? rawTagPicks : [];
  const amount = parseCount(rawAmount, { min: 0 }) ?? 0;
  if (!picks.length && amount <= 0) throw new UserError("Pick something to take.");

  // Capped at what the target actually holds, same discipline as TRANSFER_TAG
  // — a hand-crafted request can't mint items out of a stack that isn't
  // there.
  const takenTags = [];
  for (const pick of picks) {
    const held = target.tags.find((ct) => ct.tagId === pick.tagId);
    if (!held || !isTradeable(held.tag)) {
      throw new UserError("That isn't something you can take off a body.");
    }
    const quantity = held.tag.stackable
      ? (parseCount(pick.quantity, { min: 1, max: held.quantity }) ?? null)
      : held.quantity;
    if (quantity == null) throw new UserError(`Bad quantity for ${held.tag.name}.`);
    takenTags.push({
      tagId: held.tagId,
      tagName: held.tag.name,
      quantity,
      source: held.source,
      expiresTurn: held.expiresTurn,
      stackable: held.tag.stackable,
    });
  }

  if (amount > target.resources) throw new UserError(`${target.name} only has ${target.resources} ⬢.`);

  const openTurn = await getOpenTurn();

  await prisma.$transaction(async (tx) => {
    for (const t of takenTags) {
      await dropCharacterTag(tx, target.id, t.tagId, t.quantity);
      await addToStack(tx, character.id, t.tagId, t.quantity, {
        source: "EVENT",
        expiresTurn: t.expiresTurn,
        stackable: t.stackable,
      });
    }
    if (amount > 0) {
      await moveResources(tx, { kind: "character", id: target.id }, -amount);
      await moveResources(tx, { kind: "character", id: character.id }, amount);
    }

    // The snapshot Undo reads: enough per tag to restore it to the target
    // with its original source/expiry (REMOVE_TAG's restore idiom), plus the
    // ⬢ delta. Never re-derived from live state.
    const effect = {
      targetCharacterId: target.id,
      targetName: target.name,
      targetStatus: target.status,
      tags: takenTags.map((t) => ({
        tagId: t.tagId,
        tagName: t.tagName,
        quantity: t.quantity,
        source: t.source,
        expiresTurn: t.expiresTurn,
      })),
      amount,
    };
    await createRequest(tx, {
      characterId: character.id,
      turnId: openTurn?.id ?? null,
      type: "LOOT_CHARACTER",
      reason,
      payload: { targetCharacterId: target.id, tagPicks: picks, amount },
      effect,
    });
    await logRequest(tx, {
      actorDiscordUserId: session.discordUserId,
      actionType: "request_loot_character",
      targetCharacterId: target.id,
      reason,
      details: effect,
    });
  });

  // A corpse holds no channel access to reconcile, so only the living end of
  // a body-search is worth the REST call.
  await Promise.all([
    target.status === "ALIVE"
      ? syncCharacterNarrowcastAccess(target.id).catch(() => {})
      : Promise.resolve(),
    syncCharacterNarrowcastAccess(character.id).catch(() => {}),
  ]);

  const lootParts = [
    ...takenTags.map((t) => formatStack(t.tagName, t.quantity)),
    amount > 0 ? `${amount} ⬢` : null,
  ].filter(Boolean);
  if (lootParts.length) notifyCharacter(target, `Your body was searched: ${lootParts.join(", ")} taken.`);

  revalidateAll();
  return {};
}

// --- Moving another character -------------------------------------------

// A character who follows the filer: either a faction member the filer
// leads, or anyone the filer has bound. Destination is validated the same
// way an ordinary /move hop is (db/lib/travel.js#performTravel) — direct
// Zone.connectsTo neighbour of the target's current zone, never the Caves
// group row — but this does NOT spend a Move or file an Action, since it
// isn't the target's own turn-cost act. The DB write happens inside the
// transaction; the Discord zone-role swap runs after commit, same as
// changeNameRequestImpl — no network call may run inside a $transaction
// (ARCHITECTURE.md §5).
async function moveCharacterRequestImpl({ targetCharacterId, targetZoneId, reason: rawReason }) {
  const { session, character } = await requireCharacter();
  const reason = requireReason(rawReason);

  if (!character.zoneId) throw new UserError("You aren't anywhere you could do that.");

  const target = await prisma.character.findFirst({
    where: { id: targetCharacterId ?? "", status: { in: ["ALIVE", "DEAD"] }, zoneId: character.zoneId },
    include: { tags: { where: { tag: { slug: "bound" } }, select: { tagId: true } } },
  });
  if (!target) throw new UserError("They aren't here.");
  // A buried body is out of the world — see BURY_CHARACTER. Nobody drags a
  // grave to the next zone.
  if (target.buriedAt) throw new UserError("They're already in the ground.");

  // Dragging a body needs no authority over it — a corpse doesn't get a say.
  // This is the "drag a corpse" case, folded in here rather than given its own
  // request type: it is the same act with the same validation and the same
  // Undo, minus the Discord swap a dead character has no roles for.
  const isCorpse = target.status === "DEAD";
  const isBound = target.tags.length > 0;
  const commandsThem =
    character.isLeader && target.factionId != null && target.factionId === character.factionId;
  if (!isCorpse && !isBound && !commandsThem) {
    throw new UserError("You can only move someone you lead, or someone bound.");
  }

  const targetZone = await prisma.zone.findUnique({ where: { id: targetZoneId ?? "" } });
  if (!targetZone) throw new UserError("Unknown destination.");
  if (targetZone.kind === "CAVE_GROUP") throw new UserError("That isn't a place you can stand.");
  if (targetZone.id === target.zoneId) throw new UserError("They're already there.");

  const currentZone = await prisma.zone.findUnique({
    where: { id: character.zoneId },
    include: { connectsTo: { where: { id: targetZone.id } } },
  });
  if (!currentZone || currentZone.connectsTo.length === 0) {
    throw new UserError("You can't get there directly from here.");
  }

  const openTurn = await getOpenTurn();
  const fromZoneId = target.zoneId;

  await prisma.$transaction(async (tx) => {
    await tx.character.update({ where: { id: target.id }, data: { zoneId: targetZone.id } });
    await createRequest(tx, {
      characterId: character.id,
      turnId: openTurn?.id ?? null,
      type: "MOVE_CHARACTER",
      reason,
      payload: { targetCharacterId: target.id, targetZoneId: targetZone.id },
      // Undo restores fromZoneId in the DB only — it does NOT re-run the
      // Discord role swap (same posture CHANGE_NAME documents), so the
      // player's #zone channels catch up the next time they Move themselves.
      effect: {
        targetCharacterId: target.id,
        targetName: target.name,
        targetStatus: target.status,
        fromZoneId,
        toZoneId: targetZone.id,
        toZoneName: targetZone.name,
      },
    });
    await logRequest(tx, {
      actorDiscordUserId: session.discordUserId,
      actionType: "request_move_character",
      targetCharacterId: target.id,
      reason,
      details: { fromZoneId, toZoneId: targetZone.id },
    });
  });

  if (!isCorpse) {
    await syncCharacterZoneRole(target.discordUserId, fromZoneId, targetZone.id).catch(() => {});
    await syncCharacterNarrowcastAccess(target.id).catch(() => {});
  }
  notifyCharacter(target, `You were moved to ${targetZone.name}.`);
  revalidateAll();
  return {};
}

// --- Binding and freeing -------------------------------------------------

// Nothing else in the game grants `bound`, and both LOOT_CHARACTER and
// MOVE_CHARACTER's "or bound" branch key on it — so without these two the
// whole coercion loop needs a GM to start it, which is exactly the day of
// real time the Requests system exists to save (REQUESTS.md §1).
//
// There is deliberately no gate beyond co-presence. Tying someone up is an
// act with consequences, not a permission: the reason field and the GM's
// review are the anti-abuse mechanism here, same as everywhere else.
async function requireBoundTag() {
  const bound = await prisma.tag.findUnique({
    where: { slug: "bound" },
    select: { id: true, name: true, stackable: true, defaultDurationTurns: true },
  });
  if (!bound) throw new UserError("The Bound tag is missing from the catalog.");
  return bound;
}

async function bindCharacterRequestImpl({ targetCharacterId, reason: rawReason }) {
  const { session, character } = await requireCharacter();
  const reason = requireReason(rawReason);

  if (!character.zoneId) throw new UserError("You aren't anywhere you could do that.");
  if (targetCharacterId === character.id) throw new UserError("You can't bind yourself.");

  const bound = await requireBoundTag();
  const target = await prisma.character.findFirst({
    where: { id: targetCharacterId ?? "", status: "ALIVE", zoneId: character.zoneId },
    include: { tags: { where: { tagId: bound.id }, select: { tagId: true } } },
  });
  if (!target) throw new UserError("They aren't here.");
  if (target.tags.length) throw new UserError(`${target.name} is already bound.`);

  const openTurn = await getOpenTurn();
  const expiresTurn = expiryFor(bound, openTurn);

  await prisma.$transaction(async (tx) => {
    await addToStack(tx, target.id, bound.id, 1, {
      source: "EVENT",
      expiresTurn,
      stackable: bound.stackable,
    });
    const effect = {
      targetCharacterId: target.id,
      targetName: target.name,
      tagId: bound.id,
      tagName: bound.name,
      expiresTurn,
    };
    await createRequest(tx, {
      characterId: character.id,
      turnId: openTurn?.id ?? null,
      type: "BIND_CHARACTER",
      reason,
      payload: { targetCharacterId: target.id },
      effect,
    });
    await logRequest(tx, {
      actorDiscordUserId: session.discordUserId,
      actionType: "request_bind_character",
      targetCharacterId: target.id,
      reason,
      details: effect,
    });
  });

  await syncCharacterNarrowcastAccess(target.id).catch(() => {});
  notifyCharacter(target, "Someone bound you.");
  revalidateAll();
  return {};
}

// The rescue half. Anyone standing there may cut someone loose — a captor who
// wants their prisoner to stay tied has to keep other people out of the room,
// which is a fiction problem rather than a permissions one.
async function freeCharacterRequestImpl({ targetCharacterId, reason: rawReason }) {
  const { session, character } = await requireCharacter();
  const reason = requireReason(rawReason);

  if (!character.zoneId) throw new UserError("You aren't anywhere you could do that.");

  const bound = await requireBoundTag();
  const target = await prisma.character.findFirst({
    where: { id: targetCharacterId ?? "", status: "ALIVE", zoneId: character.zoneId },
    include: { tags: { where: { tagId: bound.id } } },
  });
  if (!target) throw new UserError("They aren't here.");

  const held = target.tags[0];
  if (!held) throw new UserError(`${target.name} isn't bound.`);

  const openTurn = await getOpenTurn();

  await prisma.$transaction(async (tx) => {
    await dropCharacterTag(tx, target.id, bound.id);
    // The restore snapshot, per REQUESTS.md §2 — Undo puts back the tag that
    // was there, with its original source and expiry, not a fresh grant with
    // a full duration.
    const effect = {
      targetCharacterId: target.id,
      targetName: target.name,
      tagId: bound.id,
      tagName: bound.name,
      quantity: held.quantity,
      source: held.source,
      expiresTurn: held.expiresTurn,
    };
    await createRequest(tx, {
      characterId: character.id,
      turnId: openTurn?.id ?? null,
      type: "FREE_CHARACTER",
      reason,
      payload: { targetCharacterId: target.id },
      effect,
    });
    await logRequest(tx, {
      actorDiscordUserId: session.discordUserId,
      actionType: "request_free_character",
      targetCharacterId: target.id,
      reason,
      details: effect,
    });
  });

  await syncCharacterNarrowcastAccess(target.id).catch(() => {});
  notifyCharacter(target, "Someone freed you.");
  revalidateAll();
  return {};
}

// --- Harming someone already helpless -------------------------------------

// Wounding and finishing off, in one request rather than two, because they
// are one act: you stand over someone who can't stop you and decide how far
// to take it. Either half alone is valid — a beating that leaves them alive,
// or a clean kill with no new injury — but not neither.
//
// The target must ALREADY be helpless. Knifing someone who could fight back
// is a Gambit and a GM adjudicates it; this is the aftermath, not the fight.
//
// **It does not kill.** Exactly the FEED_PERSON posture (REQUESTS.md §5a):
// letting a player end another player's game from a dropdown is too abusable,
// so `effect.lethal` only raises the ☠ in the Requests tab and surfaces the
// GM's Kill button. `effect.killed` is stamped there, not here.

async function harmCharacterRequestImpl({
  targetCharacterId,
  tagId,
  lethal: rawLethal,
  reason: rawReason,
}) {
  const { session, character } = await requireCharacter();
  const reason = requireReason(rawReason);

  if (!character.zoneId) throw new UserError("You aren't anywhere you could do that.");
  if (targetCharacterId === character.id) throw new UserError("Pick someone else.");

  const lethal = Boolean(rawLethal);
  const wantsTag = Boolean(tagId);
  if (!wantsTag && !lethal) throw new UserError("Pick an injury, tick Finish them, or both.");

  const target = await prisma.character.findFirst({
    where: { id: targetCharacterId ?? "", status: "ALIVE", zoneId: character.zoneId },
    include: { tags: { include: { tag: { select: { slug: true } } } } },
  });
  if (!target) throw new UserError("They aren't here.");

  const heldSlugs = new Set(target.tags.map((ct) => ct.tag.slug));
  if (![...heldSlugs].some((slug) => INCAPACITATING_SLUGS.has(slug))) {
    throw new UserError("They can still defend themselves — that's a Gambit, not a request.");
  }
  if (lethal && ![...heldSlugs].some((slug) => FINISHABLE_SLUGS.has(slug))) {
    throw new UserError("You can only finish off someone Dying or Bound.");
  }

  let tag = null;
  if (wantsTag) {
    tag = await prisma.tag.findUnique({
      where: { id: tagId },
      select: {
        id: true,
        name: true,
        category: true,
        stackable: true,
        defaultDurationTurns: true,
      },
    });
    if (!tag) throw new UserError("Unknown injury.");
    if (tag.category !== HEALABLE_CATEGORY) throw new UserError("That isn't an injury.");
    if (target.tags.some((ct) => ct.tagId === tag.id)) {
      throw new UserError(`${target.name} already has ${tag.name}.`);
    }
  }

  const openTurn = await getOpenTurn();
  const expiresTurn = tag ? expiryFor(tag, openTurn) : null;

  await prisma.$transaction(async (tx) => {
    if (tag) {
      await addToStack(tx, target.id, tag.id, 1, {
        source: "EVENT",
        expiresTurn,
        stackable: tag.stackable,
      });
    }
    const effect = {
      targetCharacterId: target.id,
      targetName: target.name,
      tagId: tag?.id ?? null,
      tagName: tag?.name ?? null,
      expiresTurn,
      lethal,
      killed: false,
    };
    await createRequest(tx, {
      characterId: character.id,
      turnId: openTurn?.id ?? null,
      type: "HARM_CHARACTER",
      reason,
      payload: { targetCharacterId: target.id, tagId: tag?.id ?? null, lethal },
      effect,
    });
    await logRequest(tx, {
      actorDiscordUserId: session.discordUserId,
      actionType: "request_harm_character",
      targetCharacterId: target.id,
      reason,
      details: effect,
    });
  });

  if (tag) await syncCharacterNarrowcastAccess(target.id).catch(() => {});
  // A kill, if one lands, is its own later act — the GM's Kill button, which
  // sends its own DM through killCharacter(). This one is just "you were
  // hurt", true whether or not that finishing blow ever comes.
  notifyCharacter(target, "Someone hurt you.");
  revalidateAll();
  return {};
}

// --- Desires ----------------------------------------------------------

// Setting and cancelling are NOT requests — nothing has been granted yet, so
// there's nothing for a GM to undo. Only fulfilling one moves Tag Points and
// therefore needs a reason and a review.

// Tag ids referenced by any TagGroup.requiredTagId that the character does
// NOT hold — i.e. the tags whose category is a hidden category for this
// character (schema.prisma TagGroup.requiredTagId comment; the same rule
// web/lib/characterCreation.js#requirementSatisfied enforces for the group
// gate). Deliberately NOT routed through requirementSatisfied/unlockedTags:
// those operate over a tag CATALOG (checking whether each candidate tag's
// own group is unlocked), while this needs the inverse — the raw set of
// gating tag ids — to hand to db/lib/desireGates.js, which has no DB access
// of its own. Recomputing the same TagGroup.requiredTagId rule directly
// here is simpler than adapting the catalog-shaped helper, and is exactly
// the rule documented on the schema field.
async function computeHiddenTagIds(heldTagIds) {
  const gates = await prisma.tagGroup.findMany({
    where: { requiredTagId: { not: null } },
    select: { requiredTagId: true },
  });
  return new Set(
    gates.map((g) => g.requiredTagId).filter((id) => id && !heldTagIds.has(id)),
  );
}

async function setDesireImpl({ slotIndex: rawSlotIndex, slug: rawSlug }) {
  const { session, character } = await requireCharacter();

  const slug = rawSlug?.toString().trim();
  if (!slug) throw new UserError(DESIRE_NOT_AVAILABLE);

  // Missing config row means the default (true/2) applies — same "=== false"
  // idiom as leaderWhitelistEnabled (character/page.js). Only setting a NEW
  // Desire is gated; an already-ACTIVE one can still be fulfilled/cancelled.
  const config = await prisma.gameConfig.findUnique({
    where: { id: 1 },
    select: { desiresEnabled: true, desireSlots: true },
  });
  if (config?.desiresEnabled === false) {
    throw new UserError("Temporary disabled.");
  }
  const desireSlots = config?.desireSlots ?? 2;

  const slotIndex = parseCount(rawSlotIndex, { min: 0, max: desireSlots - 1 });
  if (slotIndex == null) throw new UserError("That Desire slot doesn't exist.");

  const template = await prisma.desireTemplate.findUnique({
    where: { slug },
    include: {
      requiresAnyTags: { select: { id: true, name: true } },
      requiresNotTags: { select: { id: true, name: true } },
    },
  });
  if (!template || template.retired) throw new UserError(DESIRE_NOT_AVAILABLE);

  const roleSlugsNeeded = [
    ...(template.requiresAnyRoleSlugs ?? []),
    ...(template.requiresNotRoleSlugs ?? []),
  ];
  const roleRows = roleSlugsNeeded.length
    ? await prisma.role.findMany({ where: { slug: { in: roleSlugsNeeded } }, select: { slug: true, name: true } })
    : [];
  const roleBySlug = new Map(roleRows.map((r) => [r.slug, r]));
  const projectedTemplate = {
    ...template,
    requiresAnyRoles: (template.requiresAnyRoleSlugs ?? []).map((s) => roleBySlug.get(s)).filter(Boolean),
    requiresNotRoles: (template.requiresNotRoleSlugs ?? []).map((s) => roleBySlug.get(s)).filter(Boolean),
  };

  const heldTags = character.tags.map((ct) => ct.tag);
  const heldTagIds = new Set(heldTags.map((t) => t.id));
  const hiddenTagIds = await computeHiddenTagIds(heldTagIds);

  const openTurn = await getOpenTurn();
  const openTurnNumber = openTurn?.number ?? 0;
  const history = await prisma.desire.findMany({
    where: { characterId: character.id },
    select: { id: true, templateId: true, slotIndex: true, status: true, endedTurnNumber: true },
  });

  const { visible, hidden } = evaluateDesireCatalog({
    templates: [projectedTemplate],
    heldTags,
    hiddenTagIds,
    roleSlug: character.role?.slug ?? null,
    history,
    openTurnNumber,
  });
  if (hidden.length > 0) throw new UserError(DESIRE_NOT_AVAILABLE);
  const evaluated = visible[0];
  if (!evaluated || evaluated.state !== "available") throw new UserError(DESIRE_NOT_AVAILABLE);

  // Slot cooldown: available again strictly the turn after the slot's last
  // ended row, whether that row ended by cancel or by fulfil.
  const slots = slotStates({ history, openTurnNumber, desireSlots });
  const slot = slots[slotIndex];
  if (slot?.lockedUntilTurn != null) {
    throw new UserError("That slot is on cooldown — it opens up again next turn.");
  }

  // Check-then-create under a row lock on the character: two posts fired
  // together would otherwise both see "slot empty" and both land.
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "Character" WHERE "id" = ${character.id} FOR UPDATE`;
    const occupant = await tx.desire.findFirst({
      where: { characterId: character.id, status: "ACTIVE", slotIndex },
    });
    if (occupant) throw new UserError("That slot already has an active Desire.");
    const duplicate = await tx.desire.findFirst({
      where: { characterId: character.id, status: "ACTIVE", templateId: template.id },
    });
    if (duplicate) throw new UserError(DESIRE_NOT_AVAILABLE);
    await tx.desire.create({
      data: {
        characterId: character.id,
        templateId: template.id,
        slotIndex,
        text: template.name,
        points: template.tier,
        setTurnNumber: openTurn?.number ?? null,
      },
    });
  });
  await prisma.auditLog.create({
    data: {
      actorDiscordUserId: session.discordUserId,
      actionType: "desire_set",
      targetCharacterId: character.id,
      // text/points kept for auditNarrative.js:103; slug/name/tier/slotIndex
      // are additive.
      details: { text: template.name, points: template.tier, slug: template.slug, name: template.name, tier: template.tier, slotIndex },
    },
  });

  revalidatePath("/character");
  return {};
}

async function cancelDesireImpl({ slotIndex: rawSlotIndex }) {
  const { session, character } = await requireCharacter();
  const openTurn = await getOpenTurn();

  const slotIndex = parseCount(rawSlotIndex, { min: 0 });
  if (slotIndex == null) throw new UserError("That Desire slot doesn't exist.");

  const active = await prisma.desire.findFirst({
    where: { characterId: character.id, status: "ACTIVE", slotIndex },
  });
  if (!active) return {};

  await prisma.desire.update({
    where: { id: active.id },
    data: { status: "CANCELLED", endedTurnNumber: openTurn?.number ?? null },
  });
  await prisma.auditLog.create({
    data: {
      actorDiscordUserId: session.discordUserId,
      actionType: "desire_cancelled",
      targetCharacterId: character.id,
      details: { desireId: active.id, slotIndex },
    },
  });

  revalidatePath("/character");
  return {};
}

async function fulfillDesireRequestImpl({ desireId: rawDesireId, reason: rawReason }) {
  const { session, character } = await requireCharacter();
  const reason = requireReason(rawReason);

  const desireId = rawDesireId?.toString();
  if (!desireId) throw new UserError("You have no active Desire.");

  const openTurn = await getOpenTurn();
  // Explicit desireId, verified against this character and ACTIVE — with
  // more than one slot, "the active Desire" is ambiguous.
  const active = await prisma.desire.findFirst({
    where: { id: desireId, characterId: character.id, status: "ACTIVE" },
    include: { template: { select: { slug: true, tier: true } } },
  });
  if (!active) throw new UserError("You have no active Desire.");

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
      effect: {
        desireId: active.id,
        desireText: active.text,
        pointsAwarded: active.points,
        desireSlug: active.template?.slug ?? null,
        desireTier: active.template?.tier ?? null,
        slotIndex: active.slotIndex,
      },
    });
    await logRequest(tx, {
      actorDiscordUserId: session.discordUserId,
      actionType: "request_fulfill_desire",
      targetCharacterId: character.id,
      reason,
      details: { desireId: active.id, pointsAwarded: active.points },
    });
  });

  // Outside the transaction: the transcript row isn't part of the effect being
  // applied, and db/lib/archive.js swallows its own failures.
  await recordArchiveEvent({
    kind: "DESIRE_FULFILLED",
    character,
    zoneId: character.zoneId ?? null,
    turn: openTurn,
    content: `${character.name} fulfilled a Desire: ${active.text}`,
  });

  revalidateAll();
  return {};
}

// --- Name ---------------------------------------------------------------

// The one player-facing rename: an ordinary reason-gated request. Applies
// the same allowlist/cap/dynasty-lock rules every other writer of
// Character.name uses, then rewrites the name in one transaction. See
// docs/systemdocs/CHARACTERS.md §1b.
async function changeNameRequestImpl({ honorific: rawHonorific, firstName: rawFirstName, lastName: rawLastName, reason: rawReason }) {
  const { session, character } = await requireCharacter();
  const reason = requireReason(rawReason);

  // Gated by what this character has actually earned, from their own tags and
  // role — the dialog's dropdown is only advisory. An unearned word lands as
  // null rather than throwing, so a stale tab posting an old title renames
  // them untitled instead of failing the request.
  //
  // Note this is the player CHOOSING a title, which is the only time it is
  // re-checked. A character keeps a title after losing the tag that granted
  // it; nothing else in the app revalidates.
  const honorific = normalizeEarnedHonorific(rawHonorific, {
    tagSlugs: character.tags.map((ct) => ct.tag.slug),
    roleSlug: character.role?.slug ?? null,
    // Their own, fixed at creation. A name change buys a new name, never a
    // new gender, so this is read and never written on this path.
    gender: character.gender,
  });
  const firstName = rawFirstName?.toString().trim().slice(0, NAME_LIMITS.firstName) || null;
  if (!firstName) throw new UserError("A character needs a first name.");

  // A Baroness/Heir/Successor wears the Baron's last name, so their own
  // posted value is never read for it — same lock characterWrite.js and the
  // old creation-time writer use.
  const dynastyMember = isDynastyMember(character.role?.slug);
  const lastName = dynastyMember
    ? character.lastName
    : rawLastName?.toString().trim().slice(0, NAME_LIMITS.lastName) || null;

  const previous = {
    honorific: character.honorific,
    firstName: character.firstName,
    lastName: character.lastName,
    name: character.name,
  };
  const next = {
    honorific,
    firstName,
    lastName,
    name: formatCharacterName({ honorific, firstName, title: character.title, lastName }),
  };

  if (next.name === previous.name) throw new UserError("That's already your name.");

  const openTurn = await getOpenTurn();

  let updated;
  await prisma.$transaction(async (tx) => {
    updated = await tx.character.update({
      where: { id: character.id },
      data: next,
    });
    await createRequest(tx, {
      characterId: character.id,
      turnId: openTurn?.id ?? null,
      type: "CHANGE_NAME",
      reason,
      payload: { honorific, firstName, lastName },
      effect: { previous, next },
    });
    await logRequest(tx, {
      actorDiscordUserId: session.discordUserId,
      actionType: "request_change_name",
      targetCharacterId: character.id,
      reason,
      details: { previousName: previous.name, name: next.name },
    });
  });

  // Discord fan-out, best-effort and outside the transaction — same posture
  // as updateCharacterProfile and every other tag-consuming request here.
  // Undo (web/lib/requestEffects.js) does NOT re-run this: it can only touch
  // Postgres inside resolveRequest's transaction, so a reverted name catches
  // up with Discord the next time the player saves their Bio form.
  await ensureCharacterRole(updated).catch(() => {});
  await syncCharacterNickname(session.discordUserId, formatBareName(updated)).catch(() => {});
  await syncCharacterNarrowcastAccess(character.id).catch(() => {});
  // The Baron renaming himself renames his whole house.
  if (isDynastyHead(character.role?.slug) && next.lastName !== previous.lastName) {
    await propagateDynastyLastName(next.lastName).catch((err) =>
      console.error("propagateDynastyLastName failed:", err),
    );
  }

  revalidateAll();
  return { name: next.name };
}

// --- Burying a body -------------------------------------------------------

// The one request whose real effect lands on Discord rather than on a sheet.
// A dead player carries the Cursed role (web/lib/discordGuild.js#killCharacter),
// which caps their next character at Migrant or Bum and docks them 3 points —
// and the fiction has always said the curse lifts once the body is in the
// ground (docs/documents.yaml, the Respawning entry; the Mortus role exists to
// do it). Until now that cost a GM a manual role edit in Discord, which is the
// day of real time the Requests system exists to save.
//
// The target is TYPED, not picked, and typed as a FIRST NAME. Every other
// target menu in the app is a dropdown built from the zone roster; a dropdown
// here would be a list of the dead, readable by anyone who opened the dialog.
// First name only because an honorific or a granted title is exactly what a
// player standing over a body would not know.
//
// No gate beyond co-presence — same posture as Bind and Free. Burying someone
// is an act with consequences, not a permission, and the reason field plus the
// GM's review are the anti-abuse mechanism as everywhere else.
async function buryCharacterRequestImpl({ firstName: rawFirstName, reason: rawReason }) {
  const { session, character } = await requireCharacter();
  const reason = requireReason(rawReason);

  if (!character.zoneId) throw new UserError("You aren't anywhere you could do that.");

  const typed = rawFirstName?.toString().trim().slice(0, NAME_LIMITS.firstName) ?? "";
  if (!typed) throw new UserError("Whose name?");

  // Scoped to the filer's zone and to the unburied dead, in the WHERE rather
  // than by a second read — a body carried off between page load and submit
  // fails closed with the same wording a wrong guess gets.
  const matches = await prisma.character.findMany({
    where: {
      zoneId: character.zoneId,
      status: "DEAD",
      buriedAt: null,
      firstName: { equals: typed, mode: "insensitive" },
    },
  });
  if (matches.length === 0) throw new UserError("Nobody here by that name is dead.");
  if (matches.length > 1) {
    throw new UserError("More than one body here answers to that name. A GM will have to do it.");
  }
  const target = matches[0];

  const openTurn = await getOpenTurn();
  const buriedAt = new Date();

  await prisma.$transaction(async (tx) => {
    await tx.character.update({ where: { id: target.id }, data: { buriedAt } });
    await createRequest(tx, {
      characterId: character.id,
      turnId: openTurn?.id ?? null,
      type: "BURY_CHARACTER",
      reason,
      payload: { firstName: typed },
      // Undo reads only this. targetDiscordUserId is deliberately absent: the
      // curse is not re-granted on Undo (no network call may run inside a
      // $transaction, ARCHITECTURE.md §5), so recording the id would suggest a
      // reversal that never happens. The note tells the GM instead.
      effect: {
        targetCharacterId: target.id,
        targetName: target.name,
        zoneId: character.zoneId,
        buriedAt: buriedAt.toISOString(),
      },
    });
    await logRequest(tx, {
      actorDiscordUserId: session.discordUserId,
      actionType: "request_bury_character",
      targetCharacterId: target.id,
      reason,
      details: { zoneId: character.zoneId },
    });
  });

  // After the commit, never inside it. allow404 on the underlying call makes
  // this a no-op for a player who already re-rolled (createCharacter clears
  // the curse itself) or who has left the guild.
  await removeCursedRole(target.discordUserId).catch((err) =>
    console.error(`Bury: failed to lift the curse from ${target.discordUserId}:`, err),
  );

  notifyCharacter(target, "Your body was buried. The curse has lifted.");

  revalidateAll();
  return { name: target.name };
}

// --- Fast travel ----------------------------------------------------------

// The only request that changes a zone and files no Action. That is the whole
// tag: an ordinary hop spends the Move (db/lib/travel.js#performTravel writes
// the Action BEFORE it moves anyone), and riding does not — which also means
// the already-acted check is deliberately skipped, since riding is not acting.
//
// It re-derives performTravel's adjacency rules rather than calling it, the
// same way moveCharacterRequestImpl above does, because performTravel runs its
// own transaction and always files the Move, and createRequest has to sit
// inside the same transaction as its effect (REQUESTS.md §2).
async function fastTravelRequestImpl({ targetZoneId, passengerIds: rawPassengerIds, reason: rawReason }) {
  const { session, character } = await requireCharacter();
  const reason = requireReason(rawReason);

  if (!character.zoneId) throw new UserError("You aren't anywhere you could ride from.");
  // Re-derived from the database. The greyed-out button is a hint, not a lock.
  const heldSlugs = heldSlugsOf(character.tags);
  const seats = fastTravelCapacity(heldSlugs);
  if (seats === 0) throw new UserError("You have no horse.");

  // Deduped, self excluded (bringing "yourself" as a passenger is just
  // riding), and capped against what the vehicle actually seats — the
  // dialog caps the same way client-side, this is the real enforcement.
  const passengerIds = [...new Set((rawPassengerIds ?? []).filter((id) => id && id !== character.id))];
  if (1 + passengerIds.length > seats) {
    throw new UserError(
      seats === 1 ? "Your horse can't carry anyone else." : `Your vehicle only seats ${seats}.`,
    );
  }

  const openTurn = await getOpenTurn();
  if (!openTurn) throw new UserError("No turn is currently open.");

  const targetZone = await prisma.zone.findUnique({ where: { id: targetZoneId ?? "" } });
  if (!targetZone) throw new UserError("Unknown destination.");
  if (targetZone.kind === "CAVE_GROUP") throw new UserError("That isn't a place you can stand.");
  if (targetZone.id === character.zoneId) throw new UserError("You're already there.");

  const fromZoneId = character.zoneId;
  const currentZone = await prisma.zone.findUnique({
    where: { id: fromZoneId },
    include: { connectsTo: { where: { id: targetZone.id } } },
  });
  // Riding INTO the caves is fine — the mouth is right there off the road.
  // Riding OUT, or between levels, is not: no horse fits the tunnels. The
  // origin alone decides, so this sits before the adjacency check to give the
  // specific refusal rather than the generic one.
  if (currentZone?.kind === "CAVE_LEVEL") {
    throw new UserError("You cannot fast travel between or out of cave zones.");
  }
  if (!currentZone || currentZone.connectsTo.length === 0) {
    throw new UserError("You can't get there directly from here.");
  }

  // Passengers ride along by nobody's leave but their own presence — see the
  // dialog's own note. The only real requirement is that they're actually
  // still standing where the rider is: someone who wandered off between
  // opening the dialog and submitting fails the WHOLE request rather than
  // quietly being dropped, so the rider re-picks instead of being surprised
  // later that a friend didn't come along.
  const passengers = passengerIds.length
    ? await prisma.character.findMany({
        where: { id: { in: passengerIds }, status: "ALIVE", zoneId: fromZoneId },
        select: { id: true, name: true, discordUserId: true },
      })
    : [];
  if (passengers.length !== passengerIds.length) {
    throw new UserError("They're not here anymore.");
  }

  // fastTravelTurnId holds the in-game DAY number, not a turn id — despite
  // its name. Bascinet runs two turns per day (Dawn/Dusk, describeTurn's own
  // day = Math.ceil(turn.number / 2)), so comparing against openTurn.id let a
  // rider claim a free hop in Dawn AND another in Dusk of the same day, twice
  // what the tag promises ("once per day") and what this action's own error
  // message below says. describeTurn() is the one place that formula lives.
  const dayKey = String(describeTurn(openTurn).day);

  await prisma.$transaction(async (tx) => {
    // The claim comes FIRST, and its WHERE is the check. Read the column in
    // one statement and write it in another and two tabs both pass, which is
    // precisely how travel.js's "two hops on one Move" bug worked before the
    // Action was filed ahead of the move. A loser aborts here, before anyone
    // has been moved anywhere.
    const claimed = await tx.character.updateMany({
      where: {
        id: character.id,
        OR: [{ fastTravelTurnId: null }, { fastTravelTurnId: { not: dayKey } }],
      },
      data: { fastTravelTurnId: dayKey },
    });
    if (claimed.count === 0) throw new UserError("Your horse has already carried you today.");

    await tx.character.update({ where: { id: character.id }, data: { zoneId: targetZone.id } });
    // One batch update for every passenger: they all share the same
    // fromZoneId/toZoneId as the rider, so there's nothing per-passenger to
    // branch on here. Unlike the rider, a passenger does NOT claim their own
    // fastTravelTurnId — they're being carried, not riding their own horse,
    // so this doesn't stop them from fast-traveling under their own power
    // again later the same day.
    if (passengers.length) {
      await tx.character.updateMany({
        where: { id: { in: passengers.map((p) => p.id) } },
        data: { zoneId: targetZone.id },
      });
    }
    await createRequest(tx, {
      characterId: character.id,
      turnId: openTurn.id,
      type: "FAST_TRAVEL",
      reason,
      payload: { targetZoneId: targetZone.id, passengerIds: passengers.map((p) => p.id) },
      effect: {
        fromZoneId,
        fromZoneName: currentZone.name,
        toZoneId: targetZone.id,
        toZoneName: targetZone.name,
        // So Undo can hand the ride back rather than leaving the day burnt on
        // a hop that no longer happened.
        previousFastTravelTurnId: character.fastTravelTurnId ?? null,
        // Snapshotted names, not just ids — Undo's confirmation and the GM
        // desk's display both read this rather than re-deriving from live
        // state, the same Request.effect rule everywhere else follows.
        passengers: passengers.map((p) => ({ id: p.id, name: p.name })),
      },
    });
    await logRequest(tx, {
      actorDiscordUserId: session.discordUserId,
      actionType: "request_fast_travel",
      targetCharacterId: character.id,
      reason,
      details: { fromZoneId, toZoneId: targetZone.id, passengerIds: passengers.map((p) => p.id) },
    });
  });

  // Built once, shared by the public departure line and the archive entry
  // below so the two can't drift apart on who was aboard.
  const passengerClause = passengers.length
    ? `, carrying ${passengers.map((p) => p.name).join(" and ")}`
    : "";
  // "You'll be easily visible" is the price the tag charges for the free hop —
  // this is the half the room actually sees (the archive entry below is the
  // other half). Which vehicle is named follows what the rider holds: a horse
  // (either kind) reads as horseback, and only the Steam Automobile's
  // horseless ride falls through to its own wording.
  const rideClause =
    heldSlugs.has("horse") || heldSlugs.has("horse-windlander")
      ? "on horseback"
      : "in a steam automobile";

  // Deferred, not awaited in the request — the same handful of sequential
  // Discord calls web/app/(app)/map/travelActions.js#travelTo defers, for the
  // same reason: a pending server action blocks App Router navigation, and the
  // database write has already committed.
  after(async () => {
    // The departure zone's room sees the ride leave. Posted as the bot into
    // the zone's #summary; a cave level has no summary channel of its own, so
    // a ride out of the depths simply has nowhere to announce itself.
    if (currentZone.discordSummaryChannelId) {
      await postMessage(
        currentZone.discordSummaryChannelId,
        `*${character.name} is seen leaving the area ${rideClause}${passengerClause}.*`,
      ).catch((err) => console.error("Fast travel: departure post failed:", err));
    }
    // The rider's own fan-out, then each passenger's — sequential, same
    // shape moveCharacterRequestImpl already uses for its one target, just
    // run once per rider-or-passenger here since there can be up to six.
    const riders = [character, ...passengers];
    for (const rider of riders) {
      await syncCharacterZoneRole(rider.discordUserId, fromZoneId, targetZone.id).catch((err) =>
        console.error(`Fast travel: zone role sync failed for ${rider.id}:`, err),
      );
      await syncCharacterNarrowcastAccess(rider.id).catch((err) =>
        console.error(`Fast travel: narrowcast access sync failed for ${rider.id}:`, err),
      );
      // The second half of the /add contract: standing invites for private
      // threads in this zone land the moment their guest arrives.
      await applyPendingInvites(prisma, { ...rider, zoneId: targetZone.id }).catch((err) =>
        console.error(`Fast travel: pending thread invites failed for ${rider.id}:`, err),
      );
      // The Caving Die's "on arrival" trigger, exactly as an ordinary hop
      // fires it (db/lib/travel.js, CAVING.md) — a bonus roll on top of
      // whatever the turn-start pass already gave this rider this turn.
      // @@unique([characterId, turnId, trigger]) on CavingRoll makes a SECOND
      // ARRIVAL roll this turn a no-op rather than an error.
      if (targetZone.kind === "CAVE_LEVEL") {
        const { dm } = await rollCaving(prisma, rider, openTurn, targetZone, "ARRIVAL").catch((err) => {
          console.error(`Fast travel: caving arrival roll failed for ${rider.id}:`, err);
          return { dm: null };
        });
        if (dm) {
          await sendDm(dm.discordUserId, dm.content).catch((err) =>
            console.error(`Fast travel: caving arrival DM failed for ${rider.id}:`, err),
          );
        }
      }
    }
    // A passenger didn't ask for this ride — they should hear about it, the
    // same way Move Player notifies its target.
    for (const passenger of passengers) {
      notifyCharacter(
        passenger,
        `${character.name} brought you along to ${targetZone.name}.`,
      );
    }
  });

  // Riding is loud. The ordinary TRAVEL archive entry is off by default
  // (GameConfig.archiveTravelEvents) because it is two rows per character per
  // turn; this one is unconditional — the transcript half of the same
  // visibility the departure post above collects live.
  await recordArchiveEvent({
    kind: "TRAVEL",
    character,
    zoneId: targetZone.id,
    zoneName: targetZone.name,
    content: `${character.name} rode from ${currentZone.name} into ${targetZone.name}${passengerClause}.`,
  }).catch((err) => console.error("Fast travel: archive entry failed:", err));

  revalidatePath("/map");
  revalidateAll();
  return { name: targetZone.name };
}

// --- public surface ---------------------------------------------------

// Each action is wrapped so validation comes back as { ok: false, error }
// instead of being thrown — see web/lib/actionResult.js for why throwing is
// invisible to the player in a production build.

export async function transferResourcesRequest(input) {
  return guarded(() => transferResourcesRequestImpl(input));
}

export async function addTagRequest(input) {
  return guarded(() => addTagRequestImpl(input));
}

export async function removeTagRequest(input) {
  return guarded(() => removeTagRequestImpl(input));
}

export async function transferTagRequest(input) {
  return guarded(() => transferTagRequestImpl(input));
}

export async function consumeTagRequest(input) {
  return guarded(() => consumeTagRequestImpl(input));
}

export async function healCharacterRequest(input) {
  return guarded(() => healCharacterRequestImpl(input));
}

export async function setDesire(input) {
  return guarded(() => setDesireImpl(input));
}

export async function cancelDesire(input) {
  return guarded(() => cancelDesireImpl(input));
}

export async function fulfillDesireRequest(input) {
  return guarded(() => fulfillDesireRequestImpl(input));
}

export async function changeNameRequest(input) {
  return guarded(() => changeNameRequestImpl(input));
}

export async function lootCharacterRequest(input) {
  return guarded(() => lootCharacterRequestImpl(input));
}

export async function moveCharacterRequest(input) {
  return guarded(() => moveCharacterRequestImpl(input));
}

export async function bindCharacterRequest(input) {
  return guarded(() => bindCharacterRequestImpl(input));
}
export async function freeCharacterRequest(input) {
  return guarded(() => freeCharacterRequestImpl(input));
}
export async function harmCharacterRequest(input) {
  return guarded(() => harmCharacterRequestImpl(input));
}

export async function buryCharacterRequest(input) {
  return guarded(() => buryCharacterRequestImpl(input));
}

export async function fastTravelRequest(input) {
  return guarded(() => fastTravelRequestImpl(input));
}
