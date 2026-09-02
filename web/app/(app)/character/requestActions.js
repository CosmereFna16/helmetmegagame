"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { TURNS_PATH } from "@/lib/routes";
import { redirect } from "next/navigation";
import { prisma, isDynastyHead, isDynastyMember } from "@lifeweb/db";
import { resolveParty as dbResolveParty } from "@lifeweb/db/lib/parties";
import { applyTransfer, InsufficientResourcesError } from "@lifeweb/db/lib/resourceTransfer";
import {
  MAX_BIRD_BODY,
  canSendBird as holdsBirdAndLetters,
  isBirdReachableZone,
  deliveryDm,
  sentReceiptDm,
  replyButtonRow,
  LITERATE_SLUG,
} from "@lifeweb/db/lib/bird";
import { auth } from "@/lib/auth";
import { getOpenTurn } from "@/lib/turn";
import {
  createRequest,
  logRequest,
  requireReason,
  MAX_REASON_LENGTH,
  isDeadSimple,
  DEAD_SIMPLE_PER_TURN,
} from "@/lib/requests";
import { UserError, guarded } from "@/lib/actionResult";
import { describeTurn } from "@/lib/turnFormat";
import { expiryForGrant } from "@lifeweb/db/lib/grantExpiry";
import { isTradeable, addRequirementSatisfied } from "@/lib/tagRequests";
import {
  tagsById as buildTagsById,
  exclusiveConflict,
  conflictingTag,
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
  HEAL_SKILL_SLUG,
  buildSkillAncestry,
  healCost,
  isHealable,
  isInflictable,
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
  removeCursedRole,
  sendDm,
  killCharacter,
} from "@/lib/discordGuild";
import { applyLocationMoveSideEffects } from "@lifeweb/db/lib/locationMove";
import { syncCharacterRoomAccess } from "@lifeweb/db/lib/roomAccess";
import { rollTagChain } from "@lifeweb/db/lib/tagShapes";
import { notifyCharacter } from "@/lib/notifyCharacter";
import { evaluateDesireCatalog, slotStates } from "@lifeweb/db/lib/desireGates";
import {
  projectDesireTemplateForGates,
  loadRoleBySlugForTemplates,
  computeHiddenDesireTagIds,
} from "@/lib/desireProjection";
import { INCAPACITATING_SLUGS, FINISHABLE_SLUGS } from "@lifeweb/db/lib/incapacitation";
import { ATE_MEAL_SLUG, DISAPPOINTED_SLUG } from "@lifeweb/db/lib/constants";
import { NAME_LIMITS, formatCharacterName, formatBareName, normalizeEarnedHonorific } from "@/lib/characterName";
import { propagateDynastyLastName } from "@/lib/dynasty";

// Every player-initiated change that applies immediately and is reviewed
// afterwards. Each action: authenticate, re-validate everything the client
// sent (a server action is a public endpoint), then apply the effect and
// write the Request + AuditLog rows in ONE transaction.

// The one generic rejection text a hidden Desire and a nonexistent/retired
// one both answer with, so the wording itself can't be an oracle (DESIRES §5).
const DESIRE_NOT_AVAILABLE = "That Desire isn't available to you.";

async function requireCharacter() {
  const session = await auth();
  if (!session?.discordUserId) redirect("/");
  const character = await prisma.character.findFirst({
    where: { discordUserId: session.discordUserId, status: "ALIVE" },
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

// "character:<id>" / "faction:<id>" on both ends. The SOURCE may be any
// faction silo or any living player — see web/lib/transferReach.js for what
// it may NOT be. Lives in db/lib/parties.js beside applyTransfer, so every
// transfer surface resolves the same key; re-exported here (prisma bound).
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

  // Looting a corpse: source must be DEAD and in the same zone. Every other
  // constraint (reach, balance-covers-amount, no-self-transfer) still applies.
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
    if (from.buriedAt) throw new UserError("They're already in the ground.");
    if (!character.zoneId || from.zoneId !== character.zoneId) {
      throw new UserError("They aren't here.");
    }
    if (to.kind !== "character" || to.id !== character.id) {
      throw new UserError("You can only loot ⬢ into your own pocket.");
    }
  }

  // Both ends have to be somewhere you can stand — checked on submit, not by
  // filtering the dropdowns, since a range-filtered menu would itself be a
  // scouting tool. Loot has its own reach check above, so skip this for it.
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

  // Ordered by (kind, id) rather than sender/recipient: two simultaneous
  // opposite-direction transfers must take row locks in the same order or
  // Postgres deadlocks one of them. applyTransfer does the ordering.
  await prisma.$transaction(async (tx) => {
    // applyTransfer throws InsufficientResourcesError (a bare Error) rather
    // than UserError when a concurrent transfer already drained the balance;
    // translated here since guarded() only understands UserError.
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

  // Only a character on the receiving end learns anything — a Silo has no
  // one to DM, and loot's "recipient" is the initiator, who already knows.
  if (isLoot) {
    if (from.kind === "character") notifyCharacter(from, `You were looted for ${amount} ⬢.`);
  } else if (to.kind === "character") {
    notifyCharacter(to, `You were given ${amount} ⬢.`);
  }

  revalidateAll();
  return {};
}

// --- Tags -------------------------------------------------------------

// Dead Simple units already filed this turn (DEAD_SIMPLE_PER_TURN).
// EDITED still counts, UNDONE does not. `db` is prisma or a tx client.
async function deadSimpleUnitsThisTurn(db, characterId, turnId) {
  const filed = await db.request.findMany({
    where: { characterId, turnId, type: "ADD_TAG", status: { not: "UNDONE" } },
    select: { payload: true },
  });
  const filedTagIds = [...new Set(filed.map((r) => r.payload?.tagId).filter(Boolean))];
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
      requirementSkills: { select: { slug: true } },
    },
  });
  if (!tag) throw new UserError("Unknown tag.");
  // Re-checked here because the client's filtered list is only advisory.
  // See REQUESTS.md §3.
  if (!tag.craftable) {
    throw new UserError("That tag can't be added this way.");
  }

  // The whole catalog comes down so a chain walk never dead-ends on an
  // ancestor the character doesn't hold. exclusiveConflict()/conflictingTag()
  // read the extra fields off the held row for the checks below.
  const chainRows = await prisma.tag.findMany({
    select: {
      id: true,
      name: true,
      parentTagId: true,
      requiredTagId: true,
      exclusive: true,
      groupId: true,
      removable: true,
      conflictsWith: { select: { id: true } },
    },
  });
  const chainById = buildTagsById(
    chainRows.map((t) => ({ ...t, conflictsWithIds: t.conflictsWith.map((c) => c.id) })),
  );
  const heldIds = character.tags.map((ct) => ct.tagId);
  if (!addRequirementSatisfied(tag, chainById, heldIds)) {
    throw new UserError("You're missing a prerequisite for that tag.");
  }

  const conflict = exclusiveConflict(tag, heldIds, chainById);
  if (conflict) {
    throw new UserError(
      conflict.removable
        ? `You already hold ${conflict.name}; drop it first to take ${tag.name}.`
        : `${tag.name} can't be held with ${conflict.name}.`,
    );
  }

  const namedConflict = conflictingTag(chainById.get(tag.id) ?? tag, heldIds, chainById);
  if (namedConflict) {
    throw new UserError(`${tag.name} conflicts with ${namedConflict.name}.`);
  }

  // A chain replaces upward and never re-opens downward.
  if (heldHigherTiers(tag, chainById, heldIds).length > 0) {
    throw new UserError(`You already hold a higher tier of ${tag.name}'s chain.`);
  }

  const quantity = tag.stackable ? parseCount(rawQuantity, { min: 1, max: 99 }) ?? 1 : 1;
  if (!tag.stackable && character.tags.some((ct) => ct.tagId === tag.id)) {
    throw new UserError("You already have that tag.");
  }

  const openTurn = await getOpenTurn();

  // At most DEAD_SIMPLE_PER_TURN Dead Simple UNITS per character per turn,
  // since these recipes cost no turns and nothing else rations them. See
  // docs/systemdocs/SMITHING.md §2. Checked twice: here for a fast fail, and
  // again inside the transaction under a row lock, since two simultaneous
  // Dead Simple requests would otherwise both read the same count and pass.
  const deadSimple = Boolean(openTurn && isDeadSimple(tag));
  if (deadSimple) {
    const already = await deadSimpleUnitsThisTurn(prisma, character.id, openTurn.id);
    if (already + quantity > DEAD_SIMPLE_PER_TURN) {
      throw new UserError(
        `You can only make ${DEAD_SIMPLE_PER_TURN} Dead Simple items per turn (${already} already this turn).`,
      );
    }
  }

  // A chain replaces: the held lower tier comes off in the same transaction
  // (TAGS.md §3), snapshotted so Undo restores exactly what came off.
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
      // Row lock held to commit, so the recount sees any concurrent request.
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
      // Must arrive already stamped or it never expires — resolveNeeds()'s
      // sweep matches on expiresTurn and nothing backfills it.
      expiresTurn: await expiryForGrant(tx, tag, openTurn, {
        characterId: character.id,
        where: "addTagRequest",
      }),
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
  await syncCharacterNarrowcastAccess(character.id).catch(() => {});
  await syncCharacterRoomAccess(prisma, character).catch(() => {});
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
  const restore = {
    tagId: held.tagId,
    source: held.source,
    expiresTurn: held.expiresTurn,
    quantity,
  };

  // Aftermath (Tag.removesInto) rolled up front so the transaction commits
  // exactly what the snapshot records. Fires once regardless of quantity.
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
  await syncCharacterRoomAccess(prisma, character).catch(() => {});
  revalidateAll();
  return {};
}

// Consuming: the tag comes off and whatever Tag.consumesInto declares goes
// on. Always exactly ONE unit, so a stack feeds several times. No resource
// cost — the item already cost ⬢ to make. A grant may be conditional on
// what's already held, so the slug list runs through resolveConsumeGrants.
async function consumeTagRequestImpl({ tagId, reason: rawReason }) {
  const { session, character } = await requireCharacter();
  const reason = requireReason(rawReason);

  const held = character.tags.find((ct) => ct.tagId === tagId);
  if (!held) throw new UserError("You don't have that tag.");
  if (!held.tag.consumable) throw new UserError("That tag can't be consumed.");

  const openTurn = await getOpenTurn();
  const restore = {
    tagId: held.tagId,
    source: held.source,
    expiresTurn: held.expiresTurn,
    quantity: 1,
  };

  const {
    slugs: grantSlugs,
    durations: grantDurations,
    resources: resourcesGranted,
  } = resolveConsumeGrants(held.tag, heldSlugsOf(character.tags));

  // A proper meal lifts Disappointment on the spot, keyed off the ate-meal
  // grant rather than the item eaten. Snapshotted so Undo can restore it.
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
    // The Resources half — Purse and Supply Kit (CAVING.md). Most
    // consumables grant none, so this is usually a no-op.
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
  await syncCharacterNarrowcastAccess(character.id).catch(() => {});
  await syncCharacterRoomAccess(prisma, character).catch(() => {});
  revalidateAll();
  return {};
}

// SEND: hand one of the initiator's tradeable tags to someone in the same
// zone. LOOT: pull it off a corpse in that zone instead. There is no
// "request a tag from a living someone" — that direction stays send-only.
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

  let source;
  if (isLoot) {
    // Folded into the WHERE clause, so a corpse moved between page load and
    // submit fails closed and nothing is written.
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

  const quantity = source.tag.stackable
    ? parseCount(rawQuantity, { min: 1, max: source.quantity }) ?? 1
    : source.quantity;

  let recipient;
  if (isLoot) {
    recipient = { id: character.id, name: character.name };
  } else {
    // Same zone as ⬢, folded into the WHERE so a recipient who walks off
    // between page load and submit fails closed rather than being handed
    // whoever happens to be standing there.
    recipient = await prisma.character.findFirst({
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
      // For loot, the audit "target" is the corpse acted ON, not the receiver.
      targetCharacterId: isLoot ? source.id : recipient.id,
      reason,
      details: { tagId, tagName: source.tag.name, quantity, fromName: source.name, toName: recipient.name, direction },
    });
  });

  await Promise.all([
    syncCharacterNarrowcastAccess(source.id).catch(() => {}),
    syncCharacterNarrowcastAccess(recipient.id).catch(() => {}),
    syncCharacterRoomAccess(prisma, source).catch(() => {}),
    syncCharacterRoomAccess(prisma, recipient).catch(() => {}),
  ]);

  if (isLoot) {
    notifyCharacter(source, `Something was taken off your body: ${formatStack(source.tag.name, quantity)}.`);
  } else {
    notifyCharacter(recipient, `You were handed ${formatStack(source.tag.name, quantity)}.`);
  }

  revalidateAll();
  return {};
}

// --- Healing ----------------------------------------------------------

// Treating someone else's affliction — the only request whose subject isn't
// the filer, so most ids below are the TARGET's. Three gates, all
// re-checked here: the medic holds a Medical skill, the patient is in the
// medic's zone, and the affliction's own requirementSkills are satisfied.
// The PAYER is ungated beyond being present, same bet as TRANSFER_RESOURCES.
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

  // The flat catalog, so holding a higher tier still satisfies a requirement
  // written against the base skill.
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
  if (payer.kind === "character") {
    const present = await prisma.character.count({
      where: { id: payer.id, status: "ALIVE", zoneId: character.zoneId },
    });
    if (!present) throw new UserError("They aren't here to pay for it.");
  } else if (!(await canReachSilo(character, payer))) {
    throw new UserError(outOfReachMessage(payer, payer.zoneName));
  }

  // Straight off the tag, never off the client.
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
    selfHeal: target.id === character.id,
    tagId: held.tagId,
    tagName: held.tag.name,
    restore: {
      tagId: held.tagId,
      source: held.source,
      expiresTurn: held.expiresTurn,
      quantity: held.quantity ?? 1,
    },
    resourcesSpent: cost,
    payer: { kind: payer.kind, id: payer.id, name: payer.name },
    // What the catalog charged at the time, so a later review sees the
    // price actually quoted rather than today's tags.yaml.
    requirement: {
      turns: held.tag.requirementTurns,
      resources: held.tag.requirementResources,
      gambit: held.tag.requirementGambit,
      skills: held.tag.requirementSkills.map((t) => t.name),
    },
  };

  const aftermathSlugs = rollTagChain(held.tag.removesInto);

  await prisma.$transaction(async (tx) => {
    await debitResources(tx, payer, cost, ledger);
    await dropCharacterTag(tx, target.id, held.tagId);
    effect.granted = await grantTagSlugs(tx, target.id, aftermathSlugs, openTurn?.number ?? null);
    await createRequest(tx, {
      characterId: character.id,
      turnId: openTurn?.id ?? null,
      type: "HEAL_CHARACTER",
      reason,
      payload: { targetCharacterId: target.id, tagId, payerKey },
      effect,
    });
    await logRequest(tx, {
      actorDiscordUserId: session.discordUserId,
      actionType: "request_heal_character",
      targetCharacterId: target.id,
      reason,
      details: effect,
    });
  });

  await syncCharacterNarrowcastAccess(target.id).catch(() => {});
  await syncCharacterRoomAccess(prisma, target).catch(() => {});
  if (target.id !== character.id) {
    notifyCharacter(target, `Your ${held.tag.name} was treated.`);
  }
  revalidateAll();
  return { targetName: target.name, tagName: held.tag.name, cost };
}

// --- Looting a living, incapacitated target ----------------------------

// A helpless target (dying/catatonic/paralyzed/bound) is lootable the same
// way a corpse is; this handles both in one request, tags AND ⬢ together.
// The older TRANSFER_TAG/TRANSFER_RESOURCES LOOT direction still exists so
// old Request rows undo correctly, but nothing files one any more.
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
  if (target.buriedAt) throw new UserError("They're already in the ground.");

  // A corpse needs no further excuse; a living target has to be helpless —
  // otherwise it's a Gambit for a GM to adjudicate.
  const incapacitated =
    target.status === "DEAD" || target.tags.some((ct) => INCAPACITATING_SLUGS.has(ct.tag.slug));
  if (!incapacitated) throw new UserError("They aren't in any state to be looted.");

  const picks = Array.isArray(rawTagPicks) ? rawTagPicks : [];
  const amount = parseCount(rawAmount, { min: 0 }) ?? 0;
  if (!picks.length && amount <= 0) throw new UserError("Pick something to take.");

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

  await Promise.all([
    target.status === "ALIVE"
      ? Promise.all([
          syncCharacterNarrowcastAccess(target.id).catch(() => {}),
          syncCharacterRoomAccess(prisma, target).catch(() => {}),
        ])
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

// A character who follows the filer: a faction member the filer leads, or
// anyone helpless (bound, dying, paralyzed, catatonic, or dead). Who you may
// take is judged by ZONE — anyone standing anywhere in your zone — while
// where you may take them is judged by the Location graph, the same edge an
// ordinary walk uses. This does NOT spend a Move or file an Action, and no
// network call may run inside a $transaction (ARCHITECTURE.md §5), so the
// Discord fan-out runs after commit.
async function moveCharacterRequestImpl({ targetCharacterId, targetLocationId, reason: rawReason }) {
  const { session, character } = await requireCharacter();
  const reason = requireReason(rawReason);

  if (!character.zoneId || !character.locationId) {
    throw new UserError("You aren't anywhere you could do that.");
  }

  const target = await prisma.character.findFirst({
    where: { id: targetCharacterId ?? "", status: { in: ["ALIVE", "DEAD"] }, zoneId: character.zoneId },
    include: { tags: { select: { tag: { select: { slug: true } } } } },
  });
  if (!target) throw new UserError("They aren't here.");
  if (target.buriedAt) throw new UserError("They're already in the ground.");

  // Dragging a corpse needs no authority over it. Same for anyone helpless,
  // using the same INCAPACITATING_SLUGS set LOOT_CHARACTER and
  // HARM_CHARACTER use.
  const isCorpse = target.status === "DEAD";
  const isHelpless = target.tags.some((ct) => INCAPACITATING_SLUGS.has(ct.tag.slug));
  const commandsThem =
    character.isLeader && target.factionId != null && target.factionId === character.factionId;
  if (!isCorpse && !isHelpless && !commandsThem) {
    throw new UserError("You can only move someone you lead, or someone who can't stop you.");
  }

  const targetLocation = await prisma.location.findUnique({
    where: { id: targetLocationId ?? "" },
    include: { zone: true },
  });
  if (!targetLocation) throw new UserError("Unknown destination.");
  if (targetLocation.id === target.locationId) throw new UserError("They're already there.");

  // The edge is read off the FILER's location, not the target's — you walk
  // them out of your own doorway.
  const currentLocation = await prisma.location.findUnique({
    where: { id: character.locationId },
    include: { connectsTo: { where: { id: targetLocation.id } } },
  });
  if (!currentLocation || currentLocation.connectsTo.length === 0) {
    throw new UserError("You can't get there directly from here.");
  }

  const openTurn = await getOpenTurn();
  const fromLocationId = target.locationId;
  const fromZoneId = target.zoneId;

  await prisma.$transaction(async (tx) => {
    // The denormalization contract: locationId and zoneId written together.
    await tx.character.update({
      where: { id: target.id },
      data: { locationId: targetLocation.id, zoneId: targetLocation.zoneId },
    });
    await createRequest(tx, {
      characterId: character.id,
      turnId: openTurn?.id ?? null,
      type: "MOVE_CHARACTER",
      reason,
      payload: { targetCharacterId: target.id, targetLocationId: targetLocation.id },
      // Undo restores both ids in the DB only — the Discord role swap catches
      // up next time the player Moves themselves.
      effect: {
        targetCharacterId: target.id,
        targetName: target.name,
        targetStatus: target.status,
        fromLocationId,
        fromZoneId,
        toLocationId: targetLocation.id,
        toLocationName: targetLocation.name,
        toZoneId: targetLocation.zoneId,
        toZoneName: targetLocation.zone?.name ?? null,
      },
    });
    await logRequest(tx, {
      actorDiscordUserId: session.discordUserId,
      actionType: "request_move_character",
      targetCharacterId: target.id,
      reason,
      details: {
        fromLocationId,
        toLocationId: targetLocation.id,
        toLocationName: targetLocation.name,
      },
    });
  });

  if (!isCorpse) {
    await applyLocationMoveSideEffects(prisma, {
      characterId: target.id,
      fromLocationId,
      toLocationId: targetLocation.id,
    }).catch(() => {});
  }
  notifyCharacter(target, `You were moved to ${targetLocation.name}. ‡`);
  revalidateAll();
  return {};
}

// --- Binding and freeing -------------------------------------------------

// Nothing else grants `bound`, and it's the one incapacitating state a
// player can inflict on purpose. No gate beyond co-presence — the reason
// field and GM review are the anti-abuse mechanism, same as elsewhere.
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
  const expiresTurn = await expiryForGrant(prisma, bound, openTurn, {
    characterId: target.id,
    where: "bindCharacter",
  });

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
  await syncCharacterRoomAccess(prisma, target).catch(() => {});
  notifyCharacter(target, "Someone bound you.");
  revalidateAll();
  return {};
}

// The rescue half — anyone standing there may cut someone loose.
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
  await syncCharacterRoomAccess(prisma, target).catch(() => {});
  notifyCharacter(target, "Someone freed you.");
  revalidateAll();
  return {};
}

// --- Harming someone already helpless -------------------------------------

// Wounding and finishing off in one request, since they're one act. Either
// half alone is valid, but not neither. The target must ALREADY be helpless
// — fighting back is a Gambit for a GM. Finishing them ends their game on
// submit (REQUESTS.md §5a); the gate that makes that safe is
// FINISHABLE_SLUGS (Dying or Bound — deliberately not Catatonic, an absent
// player rather than a helpless one).
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
        slug: true,
        name: true,
        category: true,
        custom: true,
        group: { select: { slug: true } },
        stackable: true,
        defaultDurationTurns: true,
      },
    });
    if (!tag) throw new UserError("Unknown injury.");
    if (!isInflictable(tag)) throw new UserError("That isn't an injury.");
    if (target.tags.some((ct) => ct.tagId === tag.id)) {
      throw new UserError(`${target.name} already has ${tag.name}.`);
    }
  }

  const openTurn = await getOpenTurn();
  const expiresTurn = tag
    ? await expiryForGrant(prisma, tag, openTurn, { characterId: target.id, where: "harmCharacter" })
    : null;

  let killed = false;
  await prisma.$transaction(async (tx) => {
    if (tag) {
      await addToStack(tx, target.id, tag.id, 1, {
        source: "EVENT",
        expiresTurn,
        stackable: tag.stackable,
      });
    }
    // Conditional `status: ALIVE` where-clause, same as every other death
    // path (db/lib/characterDeath.js), so two finishers can't both claim it.
    if (lethal) {
      const claim = await tx.character.updateMany({
        where: { id: target.id, status: "ALIVE" },
        data: { status: "DEAD" },
      });
      killed = claim.count > 0;
    }
    const effect = {
      targetCharacterId: target.id,
      targetName: target.name,
      tagId: tag?.id ?? null,
      tagName: tag?.name ?? null,
      expiresTurn,
      lethal,
      killed,
      killedAt: killed ? new Date().toISOString() : null,
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

  // killCharacter's applyDeathToRow runs with expectStatus DEAD (the shape
  // of the claim above) and revokes access itself.
  if (killed) {
    await killCharacter(target, "Someone finished you off.").catch((err) =>
      console.error(`killCharacter failed after finishing ${target.id}:`, err),
    );
    revalidatePath("/gm/players", "layout");
  } else {
    if (tag) {
      await syncCharacterNarrowcastAccess(target.id).catch(() => {});
      await syncCharacterRoomAccess(prisma, target).catch(() => {});
    }
    notifyCharacter(target, "Someone hurt you.");
  }
  revalidateAll();
  return { killed };
}

// --- Desires ----------------------------------------------------------

// ONE action: claim a Desire — a retroactive claim on something the
// character already did. A GM reviews it afterwards like every other
// request; the anti-loop rule (DESIRES.md §8) is GM-adjudicated from the
// reason field, since no gate here can tell a real evening from a made-up one.
async function claimDesireImpl({ slotIndex: rawSlotIndex, slug: rawSlug, reason: rawReason }) {
  const { session, character } = await requireCharacter();
  const reason = requireReason(rawReason);

  const slug = rawSlug?.toString().trim();
  if (!slug) throw new UserError(DESIRE_NOT_AVAILABLE);

  const config = await prisma.gameConfig.findUnique({
    where: { id: 1 },
    select: { desiresEnabled: true, desireSlots: true, desireSlotLockTurns: true },
  });
  if (config?.desiresEnabled === false) {
    throw new UserError("Temporarily disabled.");
  }
  const desireSlots = config?.desireSlots ?? 2;
  const lockTurns = config?.desireSlotLockTurns ?? 2;

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

  const roleBySlugForDesire = await loadRoleBySlugForTemplates(prisma, [template]);
  const projectedTemplate = projectDesireTemplateForGates(roleBySlugForDesire, template);

  const heldTags = character.tags.map((ct) => ct.tag);
  const heldTagIds = new Set(heldTags.map((t) => t.id));
  const hiddenTagIds = await computeHiddenDesireTagIds(prisma, heldTagIds);
  const roleSlug = character.role?.slug ?? null;

  const openTurn = await getOpenTurn();
  const openTurnNumber = openTurn?.number ?? 0;

  // The same pure checks the picker ran. Called once outside the transaction
  // as a cheap pre-check, then again inside it on a fresh read taken after
  // the row lock, to close the TOCTOU window between the two.
  function assertAvailable(history) {
    const { visible, hidden } = evaluateDesireCatalog({
      templates: [projectedTemplate],
      heldTags,
      hiddenTagIds,
      roleSlug,
      history,
      openTurnNumber,
      desireSlots,
    });
    if (hidden.length > 0) throw new UserError(DESIRE_NOT_AVAILABLE);
    const evaluated = visible[0];
    if (!evaluated || evaluated.state !== "available") throw new UserError(DESIRE_NOT_AVAILABLE);

    const slotLock = evaluated.slotLocks?.[slotIndex];
    if (slotLock) throw new UserError(`${slotLock} in that slot.`);

    const slots = slotStates({ history, openTurnNumber, desireSlots, lockTurns });
    const slot = slots[slotIndex];
    if (slot?.lockedUntilTurn != null) {
      throw new UserError(
        `That slot is on cooldown — it opens up again on turn ${slot.lockedUntilTurn}.`,
      );
    }
  }

  const historySelect = {
    id: true,
    templateId: true,
    slotIndex: true,
    status: true,
    endedTurnNumber: true,
  };
  const historyPreCheck = await prisma.desire.findMany({
    where: { characterId: character.id },
    select: historySelect,
  });
  assertAvailable(historyPreCheck);

  // Row lock so two simultaneous claims can't both see "available" and land.
  const desire = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "Character" WHERE "id" = ${character.id} FOR UPDATE`;
    const historyInTx = await tx.desire.findMany({
      where: { characterId: character.id },
      select: historySelect,
    });
    assertAvailable(historyInTx);

    // Born ended: the claim IS the fulfilment.
    const row = await tx.desire.create({
      data: {
        characterId: character.id,
        templateId: template.id,
        slotIndex,
        text: template.name,
        points: template.tier,
        status: "FULFILLED",
        setTurnNumber: openTurn?.number ?? null,
        endedTurnNumber: openTurn?.number ?? null,
      },
    });
    await tx.character.update({
      where: { id: character.id },
      data: { tagPoints: { increment: row.points } },
    });
    await createRequest(tx, {
      characterId: character.id,
      turnId: openTurn?.id ?? null,
      type: "FULFILL_DESIRE",
      reason,
      payload: { desireId: row.id },
      effect: {
        desireId: row.id,
        desireText: row.text,
        pointsAwarded: row.points,
        desireSlug: template.slug,
        desireTier: template.tier,
        slotIndex,
      },
    });
    await logRequest(tx, {
      actorDiscordUserId: session.discordUserId,
      actionType: "request_fulfill_desire",
      targetCharacterId: character.id,
      reason,
      details: { desireId: row.id, pointsAwarded: row.points, slug: template.slug, slotIndex },
    });
    return row;
  });

  await recordArchiveEvent({
    kind: "DESIRE_FULFILLED",
    character,
    zoneId: character.zoneId ?? null,
    turn: openTurn,
    content: `${character.name} fulfilled a Desire: ${desire.text}`,
  });

  revalidateAll();
  return {};
}

// --- Name ---------------------------------------------------------------

// The one player-facing rename: an ordinary reason-gated request applying
// the same allowlist/cap/dynasty-lock rules every writer of Character.name
// uses. See docs/systemdocs/CHARACTERS.md §1b.
async function changeNameRequestImpl({ honorific: rawHonorific, firstName: rawFirstName, lastName: rawLastName, reason: rawReason }) {
  const { session, character } = await requireCharacter();
  const reason = requireReason(rawReason);

  // Gated by what this character has earned — an unearned word lands as
  // null rather than throwing, so a stale tab renames them untitled instead
  // of failing outright.
  const honorific = normalizeEarnedHonorific(rawHonorific, {
    tagSlugs: character.tags.map((ct) => ct.tag.slug),
    roleSlug: character.role?.slug ?? null,
    gender: character.gender,
  });
  const firstName = rawFirstName?.toString().trim().slice(0, NAME_LIMITS.firstName) || null;
  if (!firstName) throw new UserError("A character needs a first name.");

  // A dynasty member wears the head's last name — never read from the post.
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

  // Best-effort Discord fan-out, outside the transaction; Undo does not
  // re-run it, so a reverted name catches up next time the player saves.
  await ensureCharacterRole(updated).catch(() => {});
  await syncCharacterNickname(session.discordUserId, formatBareName(updated)).catch(() => {});
  await syncCharacterNarrowcastAccess(character.id).catch(() => {});
  await syncCharacterRoomAccess(prisma, character).catch(() => {});
  if (isDynastyHead(character.role?.slug) && next.lastName !== previous.lastName) {
    await propagateDynastyLastName(next.lastName).catch((err) =>
      console.error("propagateDynastyLastName failed:", err),
    );
  }

  revalidateAll();
  return { name: next.name };
}

// --- Burying a body -------------------------------------------------------

// A dead player carries the Cursed role until burial (web/lib/discordGuild.js
// #killCharacter); this lifts it without a GM manually editing Discord.
// Target is TYPED as a first name, not picked from a dropdown, since a
// dropdown here would list the dead for anyone who opened the dialog. No
// gate beyond co-presence, same posture as Bind and Free.
async function buryCharacterRequestImpl({ firstName: rawFirstName, reason: rawReason }) {
  const { session, character } = await requireCharacter();
  const reason = requireReason(rawReason);

  if (!character.zoneId) throw new UserError("You aren't anywhere you could do that.");

  const typed = rawFirstName?.toString().trim().slice(0, NAME_LIMITS.firstName) ?? "";
  if (!typed) throw new UserError("Whose name?");

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
      // targetDiscordUserId deliberately absent: the curse is not re-granted
      // on Undo, since no network call may run inside a $transaction.
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

  await removeCursedRole(target.discordUserId).catch((err) =>
    console.error(`Bury: failed to lift the curse from ${target.discordUserId}:`, err),
  );

  notifyCharacter(target, "Your body was buried. The curse has lifted.");

  revalidateAll();
  return { name: target.name };
}

// --- public surface ---------------------------------------------------

// Each action is wrapped so validation comes back as { ok: false, error }
// instead of being thrown — see web/lib/actionResult.js.

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

export async function claimDesire(input) {
  return guarded(() => claimDesireImpl(input));
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


// --- The Bird -------------------------------------------------------------
//
// One letter a day, to a named person in a GUESSED zone. See BIRD.md.
//
// The letter resolves INSTANTLY on a hit and SILENTLY on a miss — a wrong
// guess looks exactly like a successful send here; the sender isn't told
// until db/lib/birdPass.js reports it at turn close. That delay is the
// entire anti-scouting measure: answering "not delivered" now would hand
// every Bird-holder a free probe for whether someone is alive in a zone.
async function birdMessageRequestImpl({ recipientId, guessedZoneId, body: rawBody }) {
  const { session, character } = await requireCharacter();

  if (!holdsBirdAndLetters(character.tags)) {
    throw new UserError("You need a bird, and you need to be able to write.");
  }

  const body = (rawBody ?? "").trim();
  if (!body) throw new UserError("Write something first.");
  if (body.length > MAX_BIRD_BODY) {
    throw new UserError(`A bird can only carry ${MAX_BIRD_BODY} characters.`);
  }

  // The only Request with no reason box — the letter IS the record, clipped
  // to what the Request/AuditLog reason columns hold.
  const reason = body.slice(0, MAX_REASON_LENGTH);

  const openTurn = await getOpenTurn();
  if (!openTurn) throw new UserError("No turn is currently open.");

  // No bird will fly into or out of the deep caves.
  if (!character.zoneId) throw new UserError("You aren't anywhere a bird could leave from.");
  const fromZone = await prisma.zone.findUnique({ where: { id: character.zoneId } });
  if (!isBirdReachableZone(fromZone)) {
    throw new UserError("No bird will fly down here.");
  }

  const guessedZone = await prisma.zone.findUnique({ where: { id: guessedZoneId ?? "" } });
  if (!guessedZone) throw new UserError("Unknown destination.");
  if (!isBirdReachableZone(guessedZone)) {
    throw new UserError("No bird will fly down there.");
  }

  if (!recipientId || recipientId === character.id) {
    throw new UserError("Pick someone other than yourself.");
  }
  // Deliberately NOT filtered to the living — narrowing here would make a
  // rejection a working test for whether someone has died.
  const recipient = await prisma.character.findUnique({
    where: { id: recipientId },
    include: { tags: { include: { tag: true } } },
  });
  if (!recipient) throw new UserError("Nobody by that name.");

  const delivered = recipient.status === "ALIVE" && recipient.zoneId === guessedZone.id;
  const recipientIsLiterate = recipient.tags.some((ct) => ct.tag.slug === LITERATE_SLUG);

  // In-game DAY, not a turn id — two turns run per day, and keying on the
  // turn would hand out two letters a day. Same trap as fastTravelTurnId.
  const dayKey = String(describeTurn(openTurn).day);

  let birdMessageId = null;
  await prisma.$transaction(async (tx) => {
    const claimed = await tx.character.updateMany({
      where: {
        id: character.id,
        OR: [{ birdTurnId: null }, { birdTurnId: { not: dayKey } }],
      },
      data: { birdTurnId: dayKey },
    });
    if (claimed.count === 0) throw new UserError("Your bird has already flown today.");

    const row = await tx.birdMessage.create({
      data: {
        senderId: character.id,
        senderName: character.name,
        senderDiscordUserId: character.discordUserId ?? null,
        recipientId: recipient.id,
        recipientName: recipient.name,
        recipientDiscordUserId: recipient.discordUserId ?? null,
        guessedZoneId: guessedZone.id,
        guessedZoneName: guessedZone.name,
        body,
        delivered,
        arrivalTurnId: delivered ? openTurn.id : null,
        // Arrival turn PLUS ONE, so a letter sent minutes before turn close
        // is still answerable.
        replyDeadlineTurn: delivered ? openTurn.number + 1 : null,
      },
    });
    birdMessageId = row.id;

    await createRequest(tx, {
      characterId: character.id,
      turnId: openTurn.id,
      type: "BIRD_MESSAGE",
      reason,
      payload: { recipientId: recipient.id, guessedZoneId: guessedZone.id, body },
      effect: {
        birdMessageId: row.id,
        recipientId: recipient.id,
        recipientName: recipient.name,
        guessedZoneId: guessedZone.id,
        guessedZoneName: guessedZone.name,
        // Always plaintext, so a GM reading the desk sees what was written.
        body,
        delivered,
        previousBirdTurnId: character.birdTurnId ?? null,
      },
    });
    await logRequest(tx, {
      actorDiscordUserId: session.discordUserId,
      actionType: "request_bird_message",
      targetCharacterId: recipient.id,
      reason,
      details: {
        recipientId: recipient.id,
        guessedZoneId: guessedZone.id,
        delivered,
        birdMessageId: row.id,
      },
    });
  });

  // Post-commit — a DM must not hold up or undo the write (ARCHITECTURE.md §5).
  notifyCharacter(
    character,
    sentReceiptDm({ recipientName: recipient.name, zoneName: guessedZone.name, body }),
    { source: "bird" },
  );
  if (delivered) {
    notifyCharacter(
      recipient,
      deliveryDm({ senderName: character.name, body, recipientIsLiterate }),
      {
        // No Reply button for someone who can't read — birdReply.js re-checks.
        components: recipientIsLiterate ? replyButtonRow(birdMessageId) : undefined,
        // Plaintext rides along so /gm/messages can join the cipher to what
        // it says.
        meta: { kind: "bird", birdMessageId, plaintext: body },
        source: "bird",
      },
    );
  }

  revalidateAll();
  return { ok: true };
}

export async function birdMessageRequest(input) {
  return guarded(() => birdMessageRequestImpl(input));
}
