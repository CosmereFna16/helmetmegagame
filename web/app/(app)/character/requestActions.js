"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { TURNS_PATH } from "@/lib/routes";
import { redirect } from "next/navigation";
import { prisma, isDynastyHead, isDynastyMember } from "@lifeweb/db";
import { resolveParty as dbResolveParty } from "@lifeweb/db/lib/parties";
import { linkBetween, crossingCheck } from "@lifeweb/db/lib/locationGraph";
import { isMounted, equippedSlugs } from "@lifeweb/db/lib/mounts";
import { applyTransfer, InsufficientResourcesError } from "@lifeweb/db/lib/resourceTransfer";
import {
  canSendBird as holdsBirdAndLetters,
  isBirdReachableZone,
  deliveryDm,
  sentReceiptDm,
  replyButtonRow,
  canReadLetters,
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
  MEDICAL_TIER_CAPS,
} from "@/lib/requests";
import { UserError, guarded } from "@/lib/actionResult";
import { describeTurn } from "@/lib/turnFormat";
import { moveWindow } from "@lifeweb/db/lib/turnClock";
import { expiryForGrant } from "@lifeweb/db/lib/grantExpiry";
import { isTradeable, isCrate, addRequirementSatisfied, needsWorkshop } from "@/lib/tagRequests";
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
  takeTagFrom,
  giveTagTo,
} from "@/lib/requestEffects";
import {
  HEAL_SKILL_SLUG,
  buildSkillAncestry,
  countsAgainstHealCap,
  healCapFor,
  healCost,
  isGambitHeal,
  isHealable,
  isInflictable,
  satisfiedSkillIds,
} from "@/lib/healRequests";
import { canReachParty, outOfReachMessage, isOwnFactionSilo } from "@/lib/transferReach";
import { isHere, notHereMessage } from "@/lib/peopleHere";
import { applyBind, createBindOffer, needsNoConsent, isBound as isBoundTarget, requireBoundTag, BIND_SELECT } from "@lifeweb/db/lib/bind";
import { createLessonOffer } from "@lifeweb/db/lib/lessons";
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
import { afterInventoryChange } from "@/lib/afterInventoryChange";
import { breakSeal } from "@lifeweb/db/lib/paperMint";
import { announceInRoom } from "@lifeweb/db/lib/roomAnnounce";
import { corpsesInReach } from "@lifeweb/db/lib/corpses";
import { mintHeadstone } from "@lifeweb/db/lib/headstone";
import { dropRoomTag } from "@lifeweb/db/lib/tagWrites";
import {
  BUTCHER_SLUG,
  ENGRAVE_RESOURCE_COST,
  WORKSHOP_EQUIPMENT_SLUG,
  SURGICAL_EQUIPMENT_SLUG,
  PACKAGING_EQUIPMENT_SLUG,
  PACKAGE_MAX_LBS,
  PACKAGE_MAX_UNITS,
  PACKAGE_LABEL_MAX,
} from "@lifeweb/db/lib/constants";
import { hasAttribute, GODFLESH_ATTRIBUTE } from "@lifeweb/db/lib/locationAttributes";
import { crateWeight } from "@lifeweb/db/lib/depotCrates";
import { GODFLESH_SLUG, extractToolFor, rollExtraction, extractionDm } from "@lifeweb/db/lib/godflesh";
import { hasEquipmentInReach } from "@lifeweb/db/lib/equipmentReach";
import { carryAdmits, rowWeight } from "@lifeweb/db/lib/carry";
import { rollDie } from "@lifeweb/db/lib/moveEffects";
import { gambitModifierTotal } from "@lifeweb/db/lib/gambitModifier";
import { formatManifest } from "@lifeweb/db/lib/roomStash";
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
    // The held tags carry their GROUP as well as themselves: requireRecipeItems
    // matches a recipe's `{ group: … }` ingredient against it, and
    // db/lib/corpses.js#isCorpseTag is a group check too.
    include: {
      tags: { include: { tag: { include: { group: { select: { slug: true } } } } } },
      role: { select: { slug: true } },
    },
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

// --- Parties ------------------------------------------------------------

// "character:<id>" / "room:<id>" on both ends. Lives in db/lib/parties.js
// beside applyTransfer, so every transfer surface resolves the same key;
// re-exported here (prisma bound).
function resolveParty(key, opts) {
  return dbResolveParty(prisma, key, opts);
}

// --- Tags -------------------------------------------------------------

// Units of ONE recipe already made this turn, for a tag that sets its own
// `perTurn` (Tag.requirementPerTurn). Distinct from the Dead Simple pool
// below: that one is a shared allowance across every 0-turn recipe, this is a
// ration on a single item.
async function unitsOfTagThisTurn(db, characterId, turnId, tagId) {
  const filed = await db.request.findMany({
    where: { characterId, turnId, type: "ADD_TAG", status: { not: "UNDONE" } },
    select: { payload: true, effect: true },
  });
  return filed.reduce((sum, r) => {
    if (r.payload?.tagId !== tagId) return sum;
    return sum + (r.effect?.quantity ?? 1);
  }, 0);
}

// Routine cures already worked this turn, against MEDICAL_TIER_CAPS.
//
// Counts REQUESTS, not units — one heal is one patient — and only the ones
// that cost a turn of work: a 0-turn cure is a free action (healRequests.js).
// A gambit heal is never in here, because it files a Move instead and the
// Action unique constraint rations those on its own.
async function routineHealsThisTurn(db, characterId, turnId) {
  const filed = await db.request.findMany({
    where: { characterId, turnId, type: "HEAL_CHARACTER", status: { not: "UNDONE" } },
    select: { effect: true },
  });
  return filed.filter((r) => !r.effect?.gambit && (r.effect?.requirement?.turns ?? 0) > 0).length;
}

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

// --- Craft (docs/systemdocs/CRAFTING.md) ------------------------------

// The recipe, with everything the gates read.
async function loadRecipe(tagId) {
  const tag = await prisma.tag.findUnique({
    where: { id: tagId ?? "" },
    include: {
      group: { select: { requiredTagId: true } },
      requirementSkills: { select: { id: true, slug: true, name: true } },
    },
  });
  // requirementItems rides along on the full row `include` gives us — see
  // requireRecipeItems below. Nothing to add here; noted because a narrower
  // `select` on this query would silently disable ingredient checking.
  if (!tag) throw new UserError("Unknown tag.");
  // Re-checked here because the client's filtered list is only advisory.
  if (!tag.craftable) throw new UserError("That isn't something you can make. ‡");
  return tag;
}

// Every recipe skill, or a higher tier of it, held by the crafter.
async function requireRecipeSkills(character, tag) {
  if (!tag.requirementSkills.length) return;
  const catalog = await prisma.tag.findMany({ select: { id: true, slug: true, parentTagId: true } });
  const satisfied = satisfiedSkillIds(
    character.tags.map((ct) => ct.tagId),
    buildSkillAncestry(catalog),
  );
  const missing = tag.requirementSkills.filter((skill) => !satisfied.has(skill.id));
  if (missing.length) {
    throw new UserError(`Making that needs ${missing.map((t) => t.name).join("/")}. ‡`);
  }
}

// Smithing and building need a forge; ordinary crafting needs your hands.
//
// The rule is read off the recipe's own skills rather than a per-tag flag, so
// a new sword is gated the moment it names a smithing skill and nobody has to
// remember a second field. Reach is "hold it, or stand somewhere one is set
// up" (db/lib/equipmentReach.js) — which is what makes the Factory floor and
// the Keep's forge worth walking to. See docs/systemdocs/SMITHING.md.
async function requireWorkshop(character, tag) {
  if (!needsWorkshop(tag)) return;
  if (await hasEquipmentInReach(prisma, character, WORKSHOP_EQUIPMENT_SLUG)) return;
  throw new UserError(
    `Making that is smith's work: hold Workshop Equipment, or stand somewhere a set is already put up. ‡`,
  );
}

// The recipe's INGREDIENTS (Tag.requirementItems). Two recipes carry one, and
// they are the first ingredients this game has ever actually enforced —
// BREWING.md was explicit that nothing did.
//
// HOLDING IT IS THE CHECK. Nothing is consumed, no quantity moves, and
// crafting twice off the same corpse is fine: the recipe says you need one to
// hand, not that you use it up.
//
// Your OWN sheet only — never a room stash you could reach. A multi-turn
// project re-runs this on every continue, and "there was a corpse in a room
// nearby at the time" would mean something different on turn 3 than it did on
// turn 1. An ingredient given away mid-project stops the work, the same way a
// skill lost mid-project already does.
//
// A `group` entry matches any tag in that group, which is the only way miasma
// can accept a corpse written at death: that tag is not in docs/tags.yaml, so
// no authored slug could ever have named it.
async function requireRecipeItems(character, tag) {
  const items = Array.isArray(tag.requirementItems) ? tag.requirementItems : [];
  if (!items.length) return;
  const held = character.tags.map((ct) => ct.tag).filter(Boolean);
  const heldSlugs = new Set(held.map((t) => t.slug));
  const heldGroups = new Set(held.map((t) => t.group?.slug).filter(Boolean));
  const missing = items.filter((i) =>
    i.kind === "group" ? !heldGroups.has(i.slug) : !heldSlugs.has(i.slug),
  );
  if (missing.length) {
    throw new UserError(`Making that needs ${missing.map((i) => i.label).join(" and ")}. ‡`);
  }
}

// Prerequisite chain, exclusivity, tier replacement, duplicates — the same
// checks a purchase runs (web/lib/characterCreation.js). Returns the held
// lower tiers a grant would replace, snapshotted for Undo.
async function craftGrantChecks(character, tag) {
  // The whole catalog comes down so a chain walk never dead-ends on an
  // ancestor the character doesn't hold.
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
        ? `You already hold ${conflict.name}; destroy it first to make ${tag.name}. ‡`
        : `${tag.name} can't be held with ${conflict.name}.`,
    );
  }
  const namedConflict = conflictingTag(chainById.get(tag.id) ?? tag, heldIds, chainById);
  if (namedConflict) throw new UserError(`${tag.name} conflicts with ${namedConflict.name}.`);
  // A chain replaces upward and never re-opens downward.
  if (heldHigherTiers(tag, chainById, heldIds).length > 0) {
    throw new UserError(`You already hold a higher tier of ${tag.name}'s chain.`);
  }
  if (!tag.stackable && character.tags.some((ct) => ct.tagId === tag.id)) {
    throw new UserError("You already have that tag.");
  }
  return character.tags
    .filter((ct) => chainSiblingsToRemove(tag, chainById, heldIds).includes(ct.tagId))
    .map((ct) => ({
      tagId: ct.tagId,
      tagName: ct.tag?.name ?? null,
      source: ct.source,
      expiresTurn: ct.expiresTurn,
      quantity: ct.quantity,
    }));
}

// Who pays: you, a room here, or a person here. Defaults to you.
async function resolveCraftPayer(character, payerKey, cost) {
  const key = payerKey || `character:${character.id}`;
  const payer = await resolveParty(key);
  if (!payer) throw new UserError("Unknown payer. ‡");
  if (!(await canReachParty(character, payer))) throw new UserError(outOfReachMessage(payer));
  if (cost > payer.balance) throw new UserError(`${payer.name} only has ${payer.balance} ⬢.`);
  return payer;
}

// A craft with turns spends your Move (ADJUDICATION.md §2): one Action per
// character per turn, filed by the same rules the modal uses.
async function requireFreeMove(character, openTurn) {
  if (!openTurn) throw new UserError("No turn is open. ‡");
  const config = await prisma.gameConfig.findUnique({ where: { id: 1 }, select: { autoTurnAdvanceDisabled: true } });
  const { locked } = moveWindow(openTurn, { autoTurnAdvanceDisabled: config?.autoTurnAdvanceDisabled ?? false });
  if (locked) throw new UserError("Moves are locked for this turn. ‡");
  const acted = await prisma.action.findFirst({
    where: { characterId: character.id, turnId: openTurn.id },
    select: { id: true },
  });
  if (acted) throw new UserError("You've already used your Move this turn. ‡");
}

// A Move the player never wrote: filed for them, already PASSED, so a GM sees
// what happened without having to adjudicate it. Three callers now — Craft,
// Bury and Engrave — which is why `gmNotes` is a parameter rather than the
// hardcoded "auto:craft" this had while crafting was the only one.
//
// requireFreeMove() has usually run first, but the P2002 catch is what
// actually holds: @@unique([characterId, turnId]) is the real gate, and two
// tabs submitting at once get past a check that read the table a moment ago.
async function fileAutoRoutine(tx, character, openTurn, description, gmNotes) {
  try {
    return await tx.action.create({
      data: {
        characterId: character.id,
        turnId: openTurn.id,
        type: "MOVE",
        status: "CONFIRMED",
        confirmedAt: new Date(),
        moveKind: "ROUTINE",
        moveReviewStatus: "PASSED",
        description,
        appliedEffects: {},
        zoneId: character.zoneId ?? null,
        locationId: character.locationId ?? null,
        gmNotes,
      },
    });
  } catch (err) {
    if (err?.code === "P2002") throw new UserError("You've already used your Move this turn. ‡");
    throw err;
  }
}

function craftLabel(tag, quantity) {
  return quantity > 1 ? `${quantity}× ${tag.name}` : tag.name;
}

// The finished thing lands on the sheet: the replaced tiers come off, the
// tag goes on with its clock, and the ADD_TAG request records all of it.
async function grantCrafted(tx, { session, character, tag, quantity, openTurn, replaced, payer, cost, project = null, action = null, reason }) {
  for (const snapshot of replaced) await dropCharacterTag(tx, character.id, snapshot.tagId);
  await addToStack(tx, character.id, tag.id, quantity, {
    source: "CRAFT",
    // Must arrive already stamped or it never expires — resolveNeeds()'s
    // sweep matches on expiresTurn and nothing backfills it.
    expiresTurn: await expiryForGrant(tx, tag, openTurn, { characterId: character.id, where: "craftRequest" }),
    stackable: tag.stackable,
  });
  const payerParty = { kind: payer.kind, id: payer.id, name: payer.name };
  const request = await createRequest(tx, {
    characterId: character.id,
    turnId: openTurn?.id ?? null,
    type: "ADD_TAG",
    reason,
    payload: { tagId: tag.id, quantity, resourcesSpent: cost, payerKey: `${payer.kind}:${payer.id}` },
    effect: {
      tagId: tag.id,
      tagName: tag.name,
      quantity,
      resourcesSpent: cost,
      payer: payerParty,
      ...(project ? { projectId: project.id, turnsNeeded: project.turnsNeeded } : {}),
      ...(action ? { actionId: action.id } : {}),
      ...(replaced.length ? { replaced } : {}),
    },
  });
  await logRequest(tx, {
    actorDiscordUserId: session.discordUserId,
    actionType: "request_craft_tag",
    targetCharacterId: character.id,
    reason,
    details: { tagId: tag.id, tagName: tag.name, quantity, resourcesSpent: cost, payer: payerParty, projectId: project?.id ?? null },
  });
  return request;
}

function payerNotice(character, payer, cost, tag) {
  if (payer.kind !== "character" || payer.id === character.id || !cost) return;
  notifyCharacter(payer, `${character.name} paid ${cost} ⬢ from your purse toward ${tag.name}. ‡`);
}

async function craftRequestImpl({ tagId, quantity: rawQuantity, payerKey, reason: rawReason }) {
  const { session, character } = await requireCharacter();
  const reason = requireReason(rawReason);

  // Bound, Dying, Paralyzed, Catatonic, mid-Seizure. Somebody tied up does not
  // get to keep working; the same reasoning as the Extract gate below.
  if (character.tags.some((ct) => INCAPACITATING_SLUGS.has(ct.tag.slug))) {
    throw new UserError("You're in no state to be working. ‡");
  }

  const tag = await loadRecipe(tagId);
  await requireRecipeSkills(character, tag);
  await requireWorkshop(character, tag);
  await requireRecipeItems(character, tag);
  const replaced = await craftGrantChecks(character, tag);

  const quantity = tag.stackable ? parseCount(rawQuantity, { min: 1, max: 99 }) ?? 1 : 1;
  const turns = tag.requirementTurns ?? 1;
  const cost = (tag.requirementResources ?? 0) * quantity;
  const payer = await resolveCraftPayer(character, payerKey, cost);
  const openTurn = await getOpenTurn();

  // Dead Simple: no Move, rationed per turn (docs/systemdocs/SMITHING.md §2).
  // Checked twice: here for a fast fail, and again inside the transaction
  // under a row lock, since two simultaneous requests would otherwise both
  // read the same count and pass.
  // A recipe may also set its OWN ration (Tag.requirementPerTurn), which is
  // counted per recipe rather than against the shared Dead Simple pool.
  const perTurn = tag.requirementPerTurn ?? null;
  if (turns === 0) {
    const deadSimple = Boolean(openTurn && perTurn == null && isDeadSimple(tag));
    if (openTurn && perTurn != null) {
      const already = await unitsOfTagThisTurn(prisma, character.id, openTurn.id, tag.id);
      if (already + quantity > perTurn) {
        throw new UserError(
          `You can only make ${perTurn} ${tag.name} per turn (${already} already this turn). ‡`,
        );
      }
    }
    if (deadSimple) {
      const already = await deadSimpleUnitsThisTurn(prisma, character.id, openTurn.id);
      if (already + quantity > DEAD_SIMPLE_PER_TURN) {
        throw new UserError(
          `You can only make ${DEAD_SIMPLE_PER_TURN} Dead Simple items per turn (${already} already this turn).`,
        );
      }
    }
    await prisma.$transaction(async (tx) => {
      if (openTurn && perTurn != null) {
        await tx.$queryRaw`SELECT "id" FROM "Character" WHERE "id" = ${character.id} FOR UPDATE`;
        const already = await unitsOfTagThisTurn(tx, character.id, openTurn.id, tag.id);
        if (already + quantity > perTurn) {
          throw new UserError(`You can only make ${perTurn} ${tag.name} per turn. ‡`);
        }
      }
      if (deadSimple) {
        await tx.$queryRaw`SELECT "id" FROM "Character" WHERE "id" = ${character.id} FOR UPDATE`;
        const already = await deadSimpleUnitsThisTurn(tx, character.id, openTurn.id);
        if (already + quantity > DEAD_SIMPLE_PER_TURN) {
          throw new UserError(
            `You can only make ${DEAD_SIMPLE_PER_TURN} Dead Simple items per turn (${already} already this turn).`,
          );
        }
      }
      if (cost) await moveResources(tx, payer, -cost);
      await grantCrafted(tx, { session, character, tag, quantity, openTurn, replaced, payer, cost, reason });
    });
    await afterInventoryChange([character.id, payer.kind === "character" ? payer.id : null]);
    payerNotice(character, payer, cost, tag);
    revalidateAll();
    return { made: craftLabel(tag, quantity) };
  }

  // Real work: this turn's Move, and a project if it takes more than one.
  await requireFreeMove(character, openTurn);
  let done = false;
  await prisma.$transaction(async (tx) => {
    if (cost) await moveResources(tx, payer, -cost);
    const project = await tx.craftProject.create({
      data: {
        characterId: character.id,
        tagId: tag.id,
        quantity,
        turnsNeeded: turns,
        turnsDone: 1,
        resourcesCost: cost,
        payerKey: `${payer.kind}:${payer.id}`,
        payerName: payer.name,
        startedTurnId: openTurn.id,
        lastTurnId: openTurn.id,
      },
    });
    done = turns === 1;
    const action = await fileAutoRoutine(
      tx,
      character,
      openTurn,
      done ? `Crafted ${craftLabel(tag, quantity)}. ‡` : `Crafting ${craftLabel(tag, quantity)} (1/${turns}). ‡`,
      "auto:craft",
    );
    if (done) {
      const request = await grantCrafted(tx, { session, character, tag, quantity, openTurn, replaced, payer, cost, project, action, reason });
      await tx.craftProject.update({ where: { id: project.id }, data: { status: "DONE", requestId: request.id } });
    } else {
      await logRequest(tx, {
        actorDiscordUserId: session.discordUserId,
        actionType: "craft_started",
        targetCharacterId: character.id,
        reason,
        details: { projectId: project.id, tagId: tag.id, tagName: tag.name, quantity, turnsNeeded: turns, resourcesCost: cost, payer: { kind: payer.kind, id: payer.id, name: payer.name }, actionId: action.id },
      });
    }
  });
  await afterInventoryChange([character.id, payer.kind === "character" ? payer.id : null]);
  payerNotice(character, payer, cost, tag);
  revalidateAll();
  return done ? { made: craftLabel(tag, quantity) } : { started: craftLabel(tag, quantity), turns };
}

async function loadOwnProject(character, projectId) {
  const project = await prisma.craftProject.findFirst({
    where: { id: projectId ?? "", characterId: character.id, status: "ACTIVE" },
    include: { tag: { include: { group: { select: { requiredTagId: true } }, requirementSkills: { select: { id: true, slug: true, name: true } } } } },
  });
  if (!project) throw new UserError("That project isn't yours, or it's finished. ‡");
  return project;
}

// Another turn on a project. The recipe's gates are re-run: a skill lost
// since the start stops the work where it stands.
async function continueCraftImpl({ projectId, reason: rawReason }) {
  const { session, character } = await requireCharacter();
  const reason = requireReason(rawReason);
  const project = await loadOwnProject(character, projectId);
  const tag = project.tag;
  await requireRecipeSkills(character, tag);
  await requireWorkshop(character, tag);
  await requireRecipeItems(character, tag);
  const openTurn = await getOpenTurn();
  await requireFreeMove(character, openTurn);
  if (project.lastTurnId === openTurn.id) throw new UserError("You've already worked on that this turn. ‡");

  const payerKeyParts = (project.payerKey ?? "").split(":");
  const payer = { kind: payerKeyParts[0] || "character", id: payerKeyParts[1] || character.id, name: project.payerName ?? character.name };
  const next = project.turnsDone + 1;
  const done = next >= project.turnsNeeded;
  const replaced = done ? await craftGrantChecks(character, tag) : [];

  await prisma.$transaction(async (tx) => {
    const claim = await tx.craftProject.updateMany({
      where: { id: project.id, status: "ACTIVE", turnsDone: project.turnsDone },
      data: { turnsDone: next, lastTurnId: openTurn.id },
    });
    if (claim.count === 0) throw new UserError("That project moved on without you — reload. ‡");
    const action = await fileAutoRoutine(
      tx,
      character,
      openTurn,
      done ? `Crafted ${craftLabel(tag, project.quantity)}. ‡` : `Crafting ${craftLabel(tag, project.quantity)} (${next}/${project.turnsNeeded}). ‡`,
      "auto:craft",
    );
    if (done) {
      const request = await grantCrafted(tx, {
        session, character, tag, quantity: project.quantity, openTurn, replaced, payer, cost: project.resourcesCost, project, action, reason,
      });
      await tx.craftProject.update({ where: { id: project.id }, data: { status: "DONE", requestId: request.id } });
    } else {
      await logRequest(tx, {
        actorDiscordUserId: session.discordUserId,
        actionType: "craft_continued",
        targetCharacterId: character.id,
        reason,
        details: { projectId: project.id, tagId: tag.id, tagName: tag.name, turnsDone: next, turnsNeeded: project.turnsNeeded, actionId: action.id },
      });
    }
  });
  if (done) await afterInventoryChange(character.id);
  revalidateAll();
  return done ? { made: craftLabel(tag, project.quantity) } : { continued: craftLabel(tag, project.quantity), turnsDone: next, turns: project.turnsNeeded };
}

// Stopping keeps nothing: the ⬢ went into materials when the work began.
async function cancelCraftImpl({ projectId, reason: rawReason }) {
  const { session, character } = await requireCharacter();
  const reason = requireReason(rawReason);
  const project = await loadOwnProject(character, projectId);
  await prisma.$transaction(async (tx) => {
    await tx.craftProject.update({ where: { id: project.id }, data: { status: "CANCELLED" } });
    await logRequest(tx, {
      actorDiscordUserId: session.discordUserId,
      actionType: "craft_cancelled",
      targetCharacterId: character.id,
      reason,
      details: { projectId: project.id, tagId: project.tagId, tagName: project.tag.name, turnsDone: project.turnsDone, turnsNeeded: project.turnsNeeded, resourcesCost: project.resourcesCost },
    });
  });
  revalidateAll();
  return { cancelled: project.tag.name };
}

// --- Lessons (docs/systemdocs/LESSONS.md) ------------------------------

// Learn and Teach are the same offer from opposite ends: the initiator's
// Move slot is checked now, both sides' when the other accepts. Nothing is
// filed until then — the offer row and one DM with two buttons.
async function lessonOfferImpl({ teacherId, learnerId, tagId, reason }) {
  const { session, character } = await requireCharacter();
  const offer = await createLessonOffer(prisma, {
    initiatorId: character.id,
    teacherId,
    learnerId,
    tagId,
    reason: requireReason(reason),
  });
  if (!offer.ok) throw new UserError(offer.reason);
  after(() =>
    sendDm(offer.dm.discordUserId, offer.dm.content, { components: offer.dm.components, source: "player_event" }).catch(
      (err) => console.error(`Lesson offer DM for ${offer.offer.id} failed:`, err),
    ),
  );
  await prisma.auditLog.create({
    data: {
      actorDiscordUserId: session.discordUserId,
      actionType: "request_lesson_offer",
      targetCharacterId: offer.offer.responderId,
      reason: offer.offer.reason,
      details: { offerId: offer.offer.id, teacherId, learnerId, tagId },
    },
  });
  revalidateAll();
  return { pending: true };
}

async function learnRequestImpl({ teacherId, tagId, reason }) {
  const { character } = await requireCharacter();
  return lessonOfferImpl({ teacherId, learnerId: character.id, tagId, reason });
}

async function teachRequestImpl({ learnerId, tagId, reason }) {
  const { character } = await requireCharacter();
  return lessonOfferImpl({ teacherId: character.id, learnerId, tagId, reason });
}

// --- Destroy -------------------------------------------------------------

// Drops a `removable` tag you hold. No refund and no ⬢ field: destroying is
// throwing away, and a cure is Heal's job (docs/systemdocs/TAGS.md §5).
async function destroyTagRequestImpl({ tagId, quantity: rawQuantity, reason: rawReason }) {
  const { session, character } = await requireCharacter();
  const reason = requireReason(rawReason);

  // Bound, Dying, Paralyzed, Catatonic, mid-Seizure. Somebody tied up does not
  // get to keep working; the same reasoning as the Extract gate below.
  if (character.tags.some((ct) => INCAPACITATING_SLUGS.has(ct.tag.slug))) {
    throw new UserError("You're in no state to be working. ‡");
  }

  const held = character.tags.find((ct) => ct.tagId === tagId);
  if (!held) throw new UserError("You don't have that tag.");
  if (!held.tag.removable) throw new UserError("That isn't something you can destroy. ‡");

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
    await createRequest(tx, {
      characterId: character.id,
      turnId: openTurn?.id ?? null,
      type: "REMOVE_TAG",
      reason,
      payload: { tagId, quantity },
      effect: { tagId, tagName: held.tag.name, quantity, resourcesSpent: 0, restore, granted },
    });
    await logRequest(tx, {
      actorDiscordUserId: session.discordUserId,
      actionType: "request_destroy_tag",
      targetCharacterId: character.id,
      reason,
      details: { tagId, tagName: held.tag.name, quantity, granted: granted.map((g) => g.tagName) },
    });
  });
  await afterInventoryChange(character.id);
  revalidateAll();
  return {};
}

// Consuming: the tag comes off and whatever Tag.consumesInto declares goes
// on. Always exactly ONE unit, so a stack feeds several times. No resource
// cost — the item already cost ⬢ to make. A grant may be conditional on
// what's already held, so the slug list runs through resolveConsumeGrants.
// Breaking a seal. Opening a letter is Consume because that is what it is —
// the seal is used up and cannot be put back — and routing it through the same
// button means a player never has to learn a second verb for it.
//
// Two things come out: the letter, exactly as it was written, and the spent
// envelope. The envelope is the point of the whole mechanism: it is evidence
// that somebody opened this, and whose wax was on it when they did.
async function breakSealRequestImpl({ session, character, held, reason }) {
  const openTurn = await getOpenTurn();

  let opened;
  await prisma.$transaction(async (tx) => {
    opened = await breakSeal(tx, character.id, held.tag);

    const effect = {
      tagId: held.tagId,
      tagName: held.tag.name,
      // What the row is called NOW, so an Undo can find its way back.
      openedName: opened.paper.name,
      sealMark: held.tag.sealMark ?? null,
      envelopeTagId: opened.envelope?.id ?? null,
      envelopeName: opened.envelope?.name ?? null,
    };
    await createRequest(tx, {
      characterId: character.id,
      turnId: openTurn?.id ?? null,
      type: "BREAK_SEAL",
      reason,
      payload: { tagId: held.tagId },
      effect,
    });
    await logRequest(tx, {
      actorDiscordUserId: session.discordUserId,
      actionType: "request_break_seal",
      targetCharacterId: character.id,
      reason,
      details: effect,
    });
  });

  await afterInventoryChange([character.id]);
  revalidateAll();
  return { ok: true, name: opened.paper.name };
}

async function consumeTagRequestImpl({ tagId, reason: rawReason }) {
  const { session, character } = await requireCharacter();
  const reason = requireReason(rawReason);

  const held = character.tags.find((ct) => ct.tagId === tagId);
  if (!held) throw new UserError("You don't have that tag.");
  if (!held.tag.consumable) throw new UserError("That tag can't be consumed.");

  // Breaking a seal takes its own road out of here. The ordinary consume path
  // below reads `consumesInto`, which names CATALOG SLUGS — and the letter
  // inside a sealed one is a runtime row that no slug in docs/tags.yaml can
  // ever name. See docs/systemdocs/PAPERWORK.md.
  if (held.tag.paperKind === "SEALED") {
    return breakSealRequestImpl({ session, character, held, reason });
  }

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
  await afterInventoryChange(character.id);
  revalidateAll();
  return {};
}

// --- Transfer (the merged dialog) -------------------------------------

// One act that moves any number of tag lines and a ⬢ amount between two
// parties: yourself, a person standing here, or a Room stash at your
// Location (docs/systemdocs/CARRY.md). Files one TRANSFER_TAG per tag line
// and one TRANSFER_RESOURCES for the ⬢, all in one transaction, so a GM can
// still undo any single piece from /gm/turns.
//
// Things and ⬢ leave YOU or a room, never another person — you can't reach
// into someone's pockets from here, and listing what's in them would show
// their hidden tags. Loot is how you take from a person, and only a helpless
// one (REQUESTS.md §5b).
async function transferRequestImpl({ fromKey, toKey, tags: rawTags, amount: rawAmount, reason: rawReason }) {
  const { session, character } = await requireCharacter();
  const reason = requireReason(rawReason);

  const amount = rawAmount == null || rawAmount === "" ? 0 : parseCount(rawAmount, { min: 0 });
  if (amount == null) throw new UserError("Amount must be a whole number. ‡");
  const lines = Array.isArray(rawTags)
    ? rawTags.map((t) => ({ tagId: String(t?.tagId ?? ""), quantity: parseCount(t?.quantity ?? 1, { min: 1 }) }))
    : [];
  if (lines.some((l) => !l.tagId || l.quantity == null)) {
    throw new UserError("Each line needs a tag and a whole number. ‡");
  }
  if (new Set(lines.map((l) => l.tagId)).size !== lines.length) throw new UserError("A tag is listed twice. ‡");
  if (amount === 0 && lines.length === 0) throw new UserError("Nothing to move. ‡");

  const [from, to] = await Promise.all([resolveParty(fromKey), resolveParty(toKey)]);
  if (!from) throw new UserError("Unknown source.");
  if (!to) throw new UserError("Unknown recipient.");
  if (from.kind === to.kind && from.id === to.id) throw new UserError("Source and recipient are the same.");

  // The source is you or a room. Everything else is Loot's business.
  if (from.kind === "character" && from.id !== character.id) {
    throw new UserError("You can only hand over your own things. Loot is how you take from a person. ‡");
  }
  // Both ends have to be where you stand — re-checked here on the posted
  // key, the same predicate that built the menu (web/lib/peopleHere.js). A
  // room adds "and its door opens for you".
  //
  // The one asymmetry: `direction` lets a member DEPOSIT into their own
  // faction's silo from anywhere in that room's zone, while taking anything
  // back out keeps the strict rule (web/lib/transferReach.js).
  const heldSlugs = new Set(character.tags.map((ct) => ct.tag.slug));
  for (const [direction, party] of [["from", from], ["to", to]]) {
    if (!(await canReachParty(character, party, { heldSlugs, direction }))) {
      // Only to pick which of the two out-of-reach sentences to write —
      // the same predicate the gate itself used, not a second one.
      const isSilo = party.kind === "room" && (await isOwnFactionSilo(character, party));
      throw new UserError(outOfReachMessage(party, { isSilo }));
    }
  }
  if (amount > from.balance) throw new UserError(`${from.name} only has ${from.balance} ⬢.`);

  // Resolve every tag line against the SOURCE's holdings, snapshotting what
  // Undo will need to put back.
  const lineIds = lines.map((l) => l.tagId);
  let holdings = [];
  if (lines.length && from.kind === "room") {
    holdings = await prisma.roomTag.findMany({
      where: { roomId: from.id, tagId: { in: lineIds } },
      select: {
        tagId: true,
        quantity: true,
        expiresTurn: true,
        tag: { select: { name: true, stackable: true, tradeable: true } },
      },
    });
  } else if (lines.length) {
    holdings = character.tags
      .filter((ct) => lineIds.includes(ct.tagId))
      .map((ct) => ({ tagId: ct.tagId, quantity: ct.quantity, expiresTurn: ct.expiresTurn, source: ct.source, tag: ct.tag }));
  }
  // A non-stackable tag pins at one per character (tagWrites.js#addToStack),
  // so a pull out of a room is clamped to 1 here — silently moving 1 while
  // the request says 2 would make Undo take 2 back. Someone who already
  // holds one can't take a second at all.
  const recipientHeld =
    lines.length && to.kind === "character"
      ? new Set(
          (
            await prisma.characterTag.findMany({
              where: { characterId: to.id, tagId: { in: lineIds } },
              select: { tagId: true },
            })
          ).map((ct) => ct.tagId),
        )
      : new Set();
  const moves = lines.map((line) => {
    const held = holdings.find((h) => h.tagId === line.tagId);
    if (!held) {
      throw new UserError(from.kind === "room" ? "That isn't there any more. ‡" : "You don't have that tag.");
    }
    if (!isTradeable(held.tag)) throw new UserError("That isn't something that can change hands. ‡");
    let max = held.quantity;
    if (!held.tag.stackable && to.kind === "character") {
      if (recipientHeld.has(line.tagId)) throw new UserError(`${to.name} already has ${held.tag.name}. ‡`);
      max = 1;
    }
    const quantity = Math.min(line.quantity, max);
    return { tagId: line.tagId, quantity, held };
  });

  // The ceiling (docs/systemdocs/CARRY.md §2). A deliberate hand-over is
  // REFUSED past 1.5× the recipient's cap rather than landing and being partly
  // scattered on the floor — otherwise handing someone 300 lb would shed a
  // random slice of what they were already carrying into a public room.
  // Checked only for a character on the receiving end; a Room stash is
  // bottomless.
  if (to.kind === "character") {
    const recipient = await prisma.character.findUnique({
      where: { id: to.id },
      select: { resources: true, tags: { select: { quantity: true, equipped: true, tag: true } } },
    });
    const config = await prisma.gameConfig.findUnique({
      where: { id: 1 },
      select: { carryWeightLbs: true, carryResourceCap: true },
    });
    const addedLbs = moves.reduce((sum, m) => sum + rowWeight({ ...m.held, quantity: m.quantity }), 0);
    const verdict = carryAdmits(recipient, config, { weightLbs: addedLbs, resources: amount });
    if (!verdict.ok) {
      throw new UserError(
        to.id === character.id ? verdict.reason : `${to.name} couldn't carry that. ${verdict.reason}`,
      );
    }
  }

  const openTurn = await getOpenTurn();
  const ledger = {
    actorDiscordUserId: session.discordUserId,
    actorCharacterId: character.id,
    actorName: character.name,
    turnNumber: openTurn?.number ?? null,
    turnPhase: openTurn?.phase ?? null,
    note: reason,
  };
  const fromParty = { kind: from.kind, id: from.id, name: from.name };
  const toParty = { kind: to.kind, id: to.id, name: to.name };
  // The Spillway (Room.destroysContents). Nothing is written on the receiving
  // end — giveTagTo and moveParty both refuse — so the effect has to say so,
  // or Undo goes looking for goods that were never stored (requestEffects.js).
  const destroyed = to.destroysContents === true;
  const fromCharacterId = from.kind === "character" ? from.id : null;
  const toCharacterId = to.kind === "character" ? to.id : null;

  await prisma.$transaction(async (tx) => {
    for (const move of moves) {
      const { tagId, quantity, held } = move;
      const restore = { source: held.source ?? "EVENT", expiresTurn: held.expiresTurn ?? null, quantity };
      await takeTagFrom(tx, from, tagId, quantity);
      await giveTagTo(tx, to, { tagId, quantity, expiresTurn: held.expiresTurn ?? null, source: "EVENT" });
      await createRequest(tx, {
        characterId: character.id,
        turnId: openTurn?.id ?? null,
        type: "TRANSFER_TAG",
        reason,
        payload: { tagId, quantity, fromKey, toKey, direction: "SEND" },
        effect: {
          tagId,
          tagName: held.tag.name,
          quantity,
          direction: "SEND",
          restore,
          destroyed,
          from: fromParty,
          to: toParty,
          fromCharacterId,
          fromName: from.name,
          toCharacterId,
          toName: to.name,
        },
      });
      await logRequest(tx, {
        actorDiscordUserId: session.discordUserId,
        actionType: "request_transfer_tag",
        targetCharacterId: toCharacterId ?? fromCharacterId,
        reason,
        details: { tagId, tagName: held.tag.name, quantity, from: fromParty, to: toParty, direction: "SEND" },
      });
    }

    if (amount > 0) {
      try {
        await applyTransfer(tx, { from, to, amount, ledger });
      } catch (err) {
        if (!(err instanceof InsufficientResourcesError)) throw err;
        throw new UserError(err.message);
      }
      const effect = { amount, from: fromParty, to: toParty, direction: "SEND", destroyed };
      await createRequest(tx, {
        characterId: character.id,
        turnId: openTurn?.id ?? null,
        type: "TRANSFER_RESOURCES",
        reason,
        payload: { fromKey, toKey, amount, direction: "SEND" },
        effect,
      });
      await logRequest(tx, {
        actorDiscordUserId: session.discordUserId,
        actionType: "request_transfer_resources",
        targetCharacterId: toCharacterId ?? fromCharacterId ?? character.id,
        reason,
        details: effect,
      });
    }
  });

  await afterInventoryChange([fromCharacterId, toCharacterId]);

  const goods = formatManifest(
    moves.map((m) => ({ tagName: m.held.tag.name, quantity: m.quantity })),
    amount,
  );
  if (toCharacterId && toCharacterId !== character.id) {
    notifyCharacter({ id: to.id, discordUserId: to.discordUserId }, `You were handed ${goods}.`);
  }
  // The room hears about it, aliased (CARRY.md): leaving something is public
  // by nature, and so is walking off with it.
  if (to.kind === "room") {
    // "Leaves it here" would be a lie about the Spillway — the trough is the
    // point of the room, and anyone watching sees it go over the edge.
    after(() =>
      announceInRoom(
        to,
        character,
        destroyed ? `tips ${goods} into the trough. It is gone. ‡` : `leaves ${goods} here.`,
      ),
    );
  }
  if (from.kind === "room") after(() => announceInRoom(from, character, `takes ${goods}.`));

  revalidateAll();
  return {};
}

// --- Healing ----------------------------------------------------------

// Treating someone else's affliction — the only request whose subject isn't
// the filer, so most ids below are the TARGET's. Three gates, all
// re-checked here: the medic holds a Medical skill, the patient is standing
// here (web/lib/peopleHere.js), and the affliction's own requirementSkills
// are satisfied. The PAYER is ungated beyond being here, same bet as Craft.
async function healCharacterRequestImpl({
  targetCharacterId,
  tagId,
  payerKey,
  reason: rawReason,
}) {
  const { session, character } = await requireCharacter();
  const reason = requireReason(rawReason);

  if (!character.locationId) {
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
    where: { id: targetCharacterId ?? "", status: "ALIVE" },
    include: { tags: { include: { tag: { include: { requirementSkills: true } } } } },
  });
  if (!target || !isHere(character, target)) throw new UserError(notHereMessage(target));

  const held = target.tags.find((ct) => ct.tagId === tagId);
  if (!held || !isHealable(held.tag)) throw new UserError("That isn't something you can treat.");

  // Above your tier, or the top rung of the ladder, and it is a GAMBIT rather
  // than a refusal (docs/systemdocs/TAGS.md §5c). Nothing is out of reach any
  // more; what changes is whether you roll for it.
  const gambit = isGambitHeal(held.tag, satisfied);
  // +1 on the die for a set of instruments in reach — held, or standing in a
  // room that has one (db/lib/equipmentReach.js). Only ever asked for a
  // Gambit, since a routine cure never rolls.
  const surgical = gambit ? await hasEquipmentInReach(prisma, character, SURGICAL_EQUIPMENT_SLUG) : false;

  const openTurn = await getOpenTurn();
  if (gambit) {
    // A roll costs the Move, and Action's @@unique([characterId, turnId]) is
    // what makes it one gambit heal a turn — no separate check needed.
    await requireFreeMove(character, openTurn);
  } else if (openTurn && countsAgainstHealCap(held.tag)) {
    // A doctor's day has a ceiling. Checked here for a fast fail and again
    // inside the transaction under a row lock, since two simultaneous
    // requests would otherwise both read the same count and pass — the same
    // shape the Dead Simple cap uses.
    const heldSlugs = new Set(character.tags.map((ct) => ct.tag?.slug).filter(Boolean));
    const allowance = healCapFor(heldSlugs, MEDICAL_TIER_CAPS);
    const already = await routineHealsThisTurn(prisma, character.id, openTurn.id);
    if (already >= allowance) {
      throw new UserError(
        `You've treated ${already} ${already === 1 ? "case" : "cases"} this turn, which is all you can manage. First aid still costs you nothing. ‡`,
      );
    }
  }

  const payer = await resolveParty(payerKey);
  if (!payer) throw new UserError("Unknown payer.");
  if (!(await canReachParty(character, payer))) throw new UserError(outOfReachMessage(payer));

  // Straight off the tag, never off the client.
  const cost = healCost(held.tag);
  if (cost > payer.balance) throw new UserError(`${payer.name} only has ${payer.balance} ⬢.`);

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
    // A gambit heal is an ATTEMPT: the die is rolled at turn close and the GM
    // applies the outcome from /gm/turns, so nothing has left the patient yet.
    // `pending` is what tells Undo that no tag came off, and it is never
    // cleared — it stays true because it stays TRUE. The request charged a fee
    // and filed a Move, and that is all it ever did; whatever the GM writes
    // afterwards is their own edit, with its own audit row and its own undo.
    gambit,
    pending: gambit,
    surgical,
    // What the catalog charged at the time, so a later review sees the
    // price actually quoted rather than today's tags.yaml.
    requirement: {
      turns: held.tag.requirementTurns,
      resources: held.tag.requirementResources,
      gambit: held.tag.requirementGambit,
      skills: held.tag.requirementSkills.map((t) => t.name),
    },
  };

  // Only a routine cure has an aftermath now — a Gambit's outcome, Stitched Up
  // included, is the GM's to write once the die has been read.
  const aftermathSlugs = gambit ? [] : rollTagChain(held.tag.removesInto);

  await prisma.$transaction(async (tx) => {
    // Re-check the day's allowance under a row lock. Two tabs would otherwise
    // both read the same count and both pass (requestActions.js's Dead Simple
    // cap has the same pair of checks for the same reason).
    if (!gambit && openTurn && countsAgainstHealCap(held.tag)) {
      await tx.$queryRaw`SELECT "id" FROM "Character" WHERE "id" = ${character.id} FOR UPDATE`;
      const heldSlugs = new Set(character.tags.map((ct) => ct.tag?.slug).filter(Boolean));
      const allowance = healCapFor(heldSlugs, MEDICAL_TIER_CAPS);
      const already = await routineHealsThisTurn(tx, character.id, openTurn.id);
      if (already >= allowance) {
        throw new UserError("You've treated all the cases you can manage this turn. ‡");
      }
    }

    await debitResources(tx, payer, cost, ledger);

    if (gambit) {
      // The Move that carries the roll. Same shape as a learner's Lesson
      // Gambit (db/lib/lessons.js) — filed CONFIRMED with the die already
      // rolled, left OPEN for the GM, revealed to the player at turn close by
      // the staged push. The patient's tag is untouched: a roll that has not
      // been read cannot have cured anything, and a failed one can leave them
      // worse (docs/systemdocs/TAGS.md §5c).
      // requireFreeMove() ran above, but the P2002 catch is what actually
      // holds — @@unique([characterId, turnId]) is the real gate, and two tabs
      // submitting at once get past a check that read the table a moment ago.
      // It is also what rations gambit heals to one a turn without a second
      // count. Same posture as fileAutoRoutine().
      let action;
      try {
        action = await tx.action.create({
          data: {
            characterId: character.id,
            turnId: openTurn.id,
            type: "MOVE",
            status: "CONFIRMED",
            confirmedAt: new Date(),
            moveKind: "GAMBIT",
            moveReviewStatus: "OPEN",
            description: `Treating ${target.id === character.id ? "their own" : `${target.name}'s`} ${held.tag.name}. ‡`,
            diceRoll: rollDie(),
            diceModifier:
              gambitModifierTotal(character.tags, { hungerStreak: character.hungerStreak }) + (surgical ? 1 : 0),
            zoneId: character.zoneId ?? null,
            gmNotes: "auto:heal_gambit",
          },
        });
      } catch (err) {
        if (err?.code === "P2002") throw new UserError("You've already used your Move this turn. ‡");
        throw err;
      }
      effect.actionId = action.id;
    } else {
      await dropCharacterTag(tx, target.id, held.tagId);
      effect.granted = await grantTagSlugs(tx, target.id, aftermathSlugs, openTurn?.number ?? null);
    }

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

  await afterInventoryChange([target.id, payer.kind === "character" ? payer.id : null]);
  if (target.id !== character.id) {
    notifyCharacter(
      target,
      gambit
        ? `${character.name} is working on your ${held.tag.name}. You'll know how it went at the end of the turn. ‡`
        : `Your ${held.tag.name} was treated.`,
    );
  }
  if (payer.kind === "character" && payer.id !== character.id && cost > 0) {
    notifyCharacter(payer, `${character.name} paid ${cost} ⬢ from your purse to treat ${target.id === character.id ? "themselves" : target.name}. ‡`);
  }
  revalidateAll();
  return { targetName: target.name, tagName: held.tag.name, cost, gambit, surgical };
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

  if (!character.locationId) throw new UserError("You aren't anywhere you could do that.");

  const target = await prisma.character.findFirst({
    where: { id: targetCharacterId ?? "", status: { in: ["ALIVE", "DEAD"] } },
    include: {
      tags: {
        include: { tag: { select: { name: true, category: true, stackable: true, slug: true, tradeable: true } } },
      },
    },
  });
  if (target?.buriedAt) throw new UserError("They're already in the ground.");
  if (!target || !isHere(character, target, { allowDead: true })) throw new UserError(notHereMessage(target));

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

  // The looter's carry caps and doors, and the target's if they're alive (a
  // corpse holds nothing that needs settling).
  await afterInventoryChange([character.id, target.status === "ALIVE" ? target.id : null]);

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
// take is judged by co-presence (web/lib/peopleHere.js — standing here, not
// concealed, or a body), while where you may take them is judged by the
// Location graph, the same edge an ordinary walk uses. This does NOT spend a Move or file an Action, and no
// network call may run inside a $transaction (ARCHITECTURE.md §5), so the
// Discord fan-out runs after commit.
async function moveCharacterRequestImpl({ targetCharacterId, targetLocationId, reason: rawReason }) {
  const { session, character } = await requireCharacter();
  const reason = requireReason(rawReason);

  if (!character.locationId) {
    throw new UserError("You aren't anywhere you could do that.");
  }

  const target = await prisma.character.findFirst({
    where: { id: targetCharacterId ?? "", status: { in: ["ALIVE", "DEAD"] } },
    include: { tags: { select: { tag: { select: { slug: true } } } } },
  });
  if (target?.buriedAt) throw new UserError("They're already in the ground.");
  if (!target || !isHere(character, target, { allowDead: true })) throw new UserError(notHereMessage(target));

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
  // them out of your own doorway — and gated against the FILER's tags, since
  // they are the one opening the way. This is a server action, so it is a
  // public endpoint: the picker already dropped everything impassable, and
  // this is the check that actually holds when a client posts its own id.
  const link = await linkBetween(prisma, character.locationId, targetLocation.id);
  const gate = crossingCheck(link, {
    tagSlugs: (character.tags ?? []).map((ct) => ct.tag?.slug).filter(Boolean),
    // The FILER's mount, since they are the one leading the way through.
    mounted: isMounted(equippedSlugs(character.tags ?? [])),
  });
  if (!gate.passable) throw new UserError(gate.refusal);

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
// player can inflict on purpose. Two doors (db/lib/bind.js): someone who
// can't stop you — dead, or already helpless — is bound on the spot; anyone
// else has to agree, so the target gets a DM with Accept / Decline and the
// request fires only on Accept (docs/systemdocs/LESSONS.md).
async function bindCharacterRequestImpl({ targetCharacterId, reason: rawReason }) {
  const { session, character } = await requireCharacter();
  const reason = requireReason(rawReason);

  if (!character.locationId) throw new UserError("You aren't anywhere you could do that.");
  if (targetCharacterId === character.id) throw new UserError("You can't bind yourself.");

  const target = await prisma.character.findFirst({
    where: { id: targetCharacterId ?? "", status: { in: ["ALIVE", "DEAD"] } },
    select: BIND_SELECT,
  });
  if (!target || !isHere(character, target, { allowDead: true })) throw new UserError(notHereMessage(target));
  if (isBoundTarget(target)) throw new UserError(`${target.name} is already bound.`);

  const openTurn = await getOpenTurn();
  if (!openTurn) throw new UserError("No turn is open. ‡");

  const actor = { id: character.id, name: character.name, discordUserId: session.discordUserId };

  if (!needsNoConsent(target)) {
    const offer = await createBindOffer(prisma, { actor, target, turn: openTurn, reason });
    if (!offer.ok) throw new UserError(offer.reason);
    after(() =>
      sendDm(offer.dm.discordUserId, offer.dm.content, { components: offer.dm.components, source: "player_event" }).catch(
        (err) => console.error(`Bind offer DM to ${target.id} failed:`, err),
      ),
    );
    await prisma.auditLog.create({
      data: {
        actorDiscordUserId: session.discordUserId,
        actionType: "request_bind_offer",
        targetCharacterId: target.id,
        reason,
        details: { offerId: offer.offer.id, targetName: target.name },
      },
    });
    revalidateAll();
    return { pending: true, name: target.name };
  }

  await applyBind(prisma, { actor, target, turn: openTurn, reason });
  await afterInventoryChange(target.id);
  notifyCharacter(target, "Someone bound you.");
  revalidateAll();
  return {};
}

// The rescue half — anyone standing there may cut someone loose.
async function freeCharacterRequestImpl({ targetCharacterId, reason: rawReason }) {
  const { session, character } = await requireCharacter();
  const reason = requireReason(rawReason);

  if (!character.locationId) throw new UserError("You aren't anywhere you could do that.");

  const bound = await requireBoundTag(prisma);
  const target = await prisma.character.findFirst({
    where: { id: targetCharacterId ?? "", status: "ALIVE" },
    include: { tags: { where: { tagId: bound.id } } },
  });
  if (!target || !isHere(character, target)) throw new UserError(notHereMessage(target));

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

  await afterInventoryChange(target.id);
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

  if (!character.locationId) throw new UserError("You aren't anywhere you could do that.");
  if (targetCharacterId === character.id) throw new UserError("Pick someone else.");

  const lethal = Boolean(rawLethal);
  const wantsTag = Boolean(tagId);
  if (!wantsTag && !lethal) throw new UserError("Pick an injury, tick Finish them, or both.");

  const target = await prisma.character.findFirst({
    where: { id: targetCharacterId ?? "", status: "ALIVE" },
    include: { tags: { include: { tag: { select: { slug: true } } } } },
  });
  if (!target || !isHere(character, target)) throw new UserError(notHereMessage(target));

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
      await afterInventoryChange(target.id);
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
  await afterInventoryChange(character.id);
  if (isDynastyHead(character.role?.slug) && next.lastName !== previous.lastName) {
    await propagateDynastyLastName(next.lastName).catch((err) =>
      console.error("propagateDynastyLastName failed:", err),
    );
  }

  revalidateAll();
  return { name: next.name };
}

// --- Bodies: Butcher, Bury, Engrave --------------------------------------
//
// All three act on a CORPSE TAG rather than on a name typed into a box, which
// is the change docs/systemdocs/CORPSES.md is really about: a body is an
// object you hold or can walk up to. Engrave is the exception, and it is the
// exception on purpose — see its own comment.

// The one reach rule the three share, and the reason they cannot disagree
// about what you can touch: a corpse in your own hands, or one lying in a Room
// at your Location you can actually get into. Location-grain, because that is
// what a room stash is (CARRY.md §5).
//
// Re-resolved server-side from the posted ids every time. The dialog's list is
// advisory; this is the gate that holds when a client posts its own ids.
async function resolveCorpseSource(character, { tagId, sourceKey }) {
  const reachable = await corpsesInReach(prisma, character);
  const found = reachable.find((c) => c.tagId === tagId && c.sourceKey === sourceKey);
  // One message for both "you made that up" and "someone got there first",
  // deliberately: telling them apart would say whether a body they cannot see
  // exists, which is the scouting leak the reach rule exists to prevent.
  if (!found) throw new UserError("That body isn't there any more. ‡");
  return found;
}

// Taking the body off whatever was holding it. The conditional write IS the
// check in both branches — a room is the game's first multi-actor inventory
// (CARRY.md §5), and two of your own tabs can race just as well.
async function takeCorpse(tx, corpse) {
  if (corpse.source.kind === "room") {
    const ok = await dropRoomTag(tx, corpse.source.id, corpse.tagId, 1);
    if (!ok) throw new UserError("That body isn't there any more. ‡");
    return;
  }
  const gone = await tx.characterTag.deleteMany({
    where: { characterId: corpse.source.id, tagId: corpse.tagId },
  });
  if (gone.count === 0) throw new UserError("That body isn't there any more. ‡");
}

// Butchering. FREE — no ⬢, no Move — and it consumes the body.
//
// It deliberately does NOT free the soul: cutting someone up destroys the
// evidence without burying them, so their player stays Cursed. That is the
// hole Engrave exists to fill, and it reads as an oversight unless you know
// it was a choice.
async function butcherCorpseRequestImpl({ tagId, sourceKey, reason: rawReason }) {
  const { session, character } = await requireCharacter();
  const reason = requireReason(rawReason);

  // The gate, re-checked here because a disabled button is a hint, not a lock.
  if (!character.tags.some((ct) => ct.tag?.slug === BUTCHER_SLUG)) {
    throw new UserError("You don't know how to butcher. ‡");
  }

  const corpse = await resolveCorpseSource(character, { tagId, sourceKey });
  const yieldTag = await prisma.tag.findUnique({ where: { slug: corpse.yieldSlug } });
  // A catalog out of step with the code. Refusing is right: silently granting
  // nothing would read to the player as the button being broken.
  if (!yieldTag) throw new UserError("Nothing comes of that one. Tell a GM. ‡");

  const openTurn = await getOpenTurn();
  const expiresTurn = await expiryForGrant(prisma, yieldTag, openTurn, { reason: "butcher" });

  await prisma.$transaction(async (tx) => {
    await takeCorpse(tx, corpse);
    await addToStack(tx, character.id, yieldTag.id, 1, {
      source: "EVENT",
      expiresTurn,
      stackable: yieldTag.stackable,
    });
    await createRequest(tx, {
      characterId: character.id,
      turnId: openTurn?.id ?? null,
      type: "BUTCHER_CORPSE",
      reason,
      payload: { tagId, sourceKey },
      // The source is snapshotted so Undo can put the body back where it came
      // FROM — a corpse taken off a floor must not reappear in a pocket.
      effect: {
        corpseTagId: corpse.tagId,
        corpseTagName: corpse.tagName,
        source: corpse.source,
        yieldTagId: yieldTag.id,
        yieldTagName: yieldTag.name,
        yieldExpiresTurn: expiresTurn,
        human: corpse.human,
        deadCharacterId: corpse.deadCharacterId,
        deadName: corpse.deadName,
      },
    });
    await logRequest(tx, {
      actorDiscordUserId: session.discordUserId,
      actionType: "request_butcher_corpse",
      targetCharacterId: corpse.deadCharacterId ?? character.id,
      reason,
      details: { corpse: corpse.tagName, made: yieldTag.name, source: corpse.source.kind },
    });
  });

  await afterInventoryChange([character.id]);

  // The dead player is told, and never told by whom — the same posture every
  // other request that acts on someone else takes.
  if (corpse.human && corpse.deadCharacterId) {
    const dead = await prisma.character.findUnique({ where: { id: corpse.deadCharacterId } });
    if (dead) notifyCharacter(dead, "Somebody has cut your body apart. ‡");
  }
  // A public room's contents changing is public by nature (CARRY.md §6).
  if (corpse.source.kind === "room") {
    after(() => announceInRoom(corpse.source, character, "butchers a body here."));
  }

  revalidateAll();
  return { made: yieldTag.name };
}

// Burying. Takes the body — you have to actually have it, or be able to reach
// it — and spends your Move.
//
// The old version matched a TYPED first name against the dead in your zone.
// That input has not gone away; it moved to Engrave, which is the one that
// still needs it.
async function buryCharacterRequestImpl({ tagId, sourceKey, reason: rawReason }) {
  const { session, character } = await requireCharacter();
  const reason = requireReason(rawReason);

  const corpse = await resolveCorpseSource(character, { tagId, sourceKey });
  if (!corpse.human || !corpse.deadCharacterId) {
    throw new UserError("There's no soul in that one. ‡");
  }
  const target = await prisma.character.findUnique({ where: { id: corpse.deadCharacterId } });
  if (!target) throw new UserError("There's nobody left to bury. ‡");
  if (target.buriedAt) throw new UserError("They're already in the ground. ‡");

  const openTurn = await getOpenTurn();
  await requireFreeMove(character, openTurn);
  const buriedAt = new Date();

  await prisma.$transaction(async (tx) => {
    await takeCorpse(tx, corpse);
    await tx.character.update({ where: { id: target.id }, data: { buriedAt } });
    const action = await fileAutoRoutine(
      tx,
      character,
      openTurn,
      `Buried ${target.name}. ‡`,
      "auto:bury",
    );
    await createRequest(tx, {
      characterId: character.id,
      turnId: openTurn?.id ?? null,
      type: "BURY_CHARACTER",
      reason,
      payload: { tagId, sourceKey },
      // targetDiscordUserId deliberately absent: the curse is not re-granted
      // on Undo, since no network call may run inside a $transaction.
      effect: {
        targetCharacterId: target.id,
        targetName: target.name,
        zoneId: character.zoneId,
        buriedAt: buriedAt.toISOString(),
        corpseTagId: corpse.tagId,
        corpseTagName: corpse.tagName,
        source: corpse.source,
        actionId: action?.id ?? null,
      },
    });
    await logRequest(tx, {
      actorDiscordUserId: session.discordUserId,
      actionType: "request_bury_character",
      targetCharacterId: target.id,
      reason,
      details: { zoneId: character.zoneId, corpse: corpse.tagName },
    });
  });

  await removeCursedRole(target.discordUserId).catch((err) =>
    console.error(`Bury: failed to lift the curse from ${target.discordUserId}:`, err),
  );
  await afterInventoryChange([character.id]);

  notifyCharacter(target, "Your body was buried. The curse has lifted.");
  if (corpse.source.kind === "room") {
    after(() => announceInRoom(corpse.source, character, "takes a body away."));
  }

  revalidateAll();
  return { name: target.name };
}

// Engraving. The answer to a body nobody can find — so it is the ONE action
// here with no corpse and no reach check at all, and it searches the whole
// game rather than your zone.
//
// This is where Bury's typed first name went, and the reasoning that kept it
// typed is unchanged and now stronger: a dropdown would answer "who is dead?"
// to anyone who opened the dialog, and the list would now be every corpse in
// Ravenheart rather than the ones at your feet.
//
// The >1-match refusal matters far more than it used to for the same reason.
// It is the only thing standing between a mourner and freeing the wrong soul.
async function engraveHeadstoneRequestImpl({ firstName: rawFirstName, reason: rawReason }) {
  const { session, character } = await requireCharacter();
  const reason = requireReason(rawReason);

  const typed = rawFirstName?.toString().trim().slice(0, NAME_LIMITS.firstName) ?? "";
  if (!typed) throw new UserError("Whose name?");

  // No zone clause, on purpose (see above).
  const matches = await prisma.character.findMany({
    where: { status: "DEAD", buriedAt: null, firstName: { equals: typed, mode: "insensitive" } },
  });
  if (matches.length === 0) throw new UserError("Nobody by that name is dead and unburied. ‡");
  if (matches.length > 1) {
    throw new UserError("More than one dead person answers to that name. A GM will have to do it. ‡");
  }
  const target = matches[0];

  // The friendly refusal. The real check is the conditional debit below, which
  // is what actually stops the balance going negative.
  if (character.resources < ENGRAVE_RESOURCE_COST) {
    throw new UserError(`Engraving costs ${ENGRAVE_RESOURCE_COST} ⬢. ‡`);
  }

  const openTurn = await getOpenTurn();
  await requireFreeMove(character, openTurn);
  const buriedAt = new Date();

  const result = await prisma.$transaction(async (tx) => {
    // The conditional debit, which is the check that actually holds — the
    // friendly refusal above only makes the message better.
    await debitResources(
      tx,
      { kind: "character", id: character.id, name: character.name },
      ENGRAVE_RESOURCE_COST,
    );
    await tx.character.update({ where: { id: target.id }, data: { buriedAt } });
    const headstone = await mintHeadstone(tx, target);
    await addToStack(tx, character.id, headstone.id, 1, {
      source: "EVENT",
      expiresTurn: null,
      stackable: false,
    });
    const action = await fileAutoRoutine(
      tx,
      character,
      openTurn,
      `Engraved a headstone for ${target.name}. ‡`,
      "auto:engrave",
    );
    await createRequest(tx, {
      characterId: character.id,
      turnId: openTurn?.id ?? null,
      type: "ENGRAVE_HEADSTONE",
      reason,
      payload: { firstName: typed },
      effect: {
        targetCharacterId: target.id,
        targetName: target.name,
        buriedAt: buriedAt.toISOString(),
        resourcesSpent: ENGRAVE_RESOURCE_COST,
        headstoneTagId: headstone.id,
        headstoneTagName: headstone.name,
        actionId: action?.id ?? null,
      },
    });
    await logRequest(tx, {
      actorDiscordUserId: session.discordUserId,
      actionType: "request_engrave_headstone",
      targetCharacterId: target.id,
      reason,
      details: { spent: ENGRAVE_RESOURCE_COST },
    });
    return { headstone };
  });

  await removeCursedRole(target.discordUserId).catch((err) =>
    console.error(`Engrave: failed to lift the curse from ${target.discordUserId}:`, err),
  );
  await afterInventoryChange([character.id]);

  notifyCharacter(target, "Somebody carved your name in stone. The curse has lifted. ‡");

  revalidateAll();
  return { name: target.name, headstone: result.headstone.name };
}

// --- The Godard Factory -----------------------------------------------

// Cutting Godflesh out of the marsh. Spends the Routine, rolls a d6, and on a
// 1 rolls again on a table that Armored Gloves dominate — db/lib/godflesh.js
// holds all of that, and this only writes the result down.
//
// Every gate is re-checked here. The button greys itself for a blade and hides
// itself off a marsh tile, but a server action is a public endpoint and the
// client's menus are advisory (REQUESTS.md §3).
async function extractGodfleshRequestImpl({ reason: rawReason }) {
  const { session, character } = await requireCharacter();
  const reason = requireReason(rawReason);

  const location = character.locationId
    ? await prisma.location.findUnique({
        where: { id: character.locationId },
        select: { id: true, name: true, attributes: true },
      })
    : null;
  if (!hasAttribute(location, GODFLESH_ATTRIBUTE)) {
    throw new UserError("There's nothing to cut here. ‡");
  }
  if (!extractToolFor(character.tags)) {
    throw new UserError("You need a hatchet, a battle-axe or a chainsaw in your hands. ‡");
  }
  // Bound, Dying, Paralyzed, Catatonic — or mid-Seizure from a cube, which is
  // the one this exists for. requireFreeMove below only checks the turn and
  // the one-Action rule, so nothing else would stop a man on the floor wading
  // into the marsh with an axe.
  if (character.tags.some((ct) => INCAPACITATING_SLUGS.has(ct.tag.slug))) {
    throw new UserError("You're in no state to be swinging anything. ‡");
  }

  const openTurn = await getOpenTurn();
  await requireFreeMove(character, openTurn);

  const result = rollExtraction(character.tags);
  const [godflesh, injury] = await Promise.all([
    prisma.tag.findUnique({ where: { slug: GODFLESH_SLUG }, select: { id: true, name: true, stackable: true } }),
    result.injury
      ? prisma.tag.findUnique({
          where: { slug: result.injury.tagSlug },
          select: { id: true, name: true, defaultDurationTurns: true },
        })
      : null,
  ]);
  if (!godflesh) throw new UserError("The catalog has no Godflesh in it. Tell a GM. ‡");

  const effect = {
    die: result.die,
    tool: result.tool,
    tagId: godflesh.id,
    tagName: godflesh.name,
    quantity: result.quantity,
    injuryTagId: injury?.id ?? null,
    injuryTagName: injury?.name ?? null,
    locationName: location?.name ?? null,
  };

  await prisma.$transaction(async (tx) => {
    await addToStack(tx, character.id, godflesh.id, result.quantity, {
      source: "EVENT",
      stackable: godflesh.stackable,
    });
    if (injury) {
      await addToStack(tx, character.id, injury.id, 1, {
        source: "EVENT",
        expiresTurn: await expiryForGrant(tx, injury, openTurn, {
          characterId: character.id,
          where: "extractGodflesh",
        }),
      });
    }
    const action = await fileAutoRoutine(
      tx,
      character,
      openTurn,
      "*Out in the marsh, cutting.* ‡",
      "auto:extract",
    );
    effect.actionId = action.id;
    await createRequest(tx, {
      characterId: character.id,
      turnId: openTurn?.id ?? null,
      type: "EXTRACT_GODFLESH",
      reason,
      payload: {},
      effect,
    });
    await logRequest(tx, {
      actorDiscordUserId: session.discordUserId,
      actionType: "request_extract_godflesh",
      targetCharacterId: character.id,
      reason,
      details: effect,
    });
  });

  await afterInventoryChange([character.id]);
  // The die is the point of the whole button, so it is DM'd whatever it said.
  notifyCharacter(character, extractionDm(result, { locationName: location?.name ?? null }));

  revalidateAll();
  return { die: result.die, quantity: result.quantity, injury: injury?.name ?? null };
}

// Packing goods into a crate that weighs half what is in it.
//
// The crate is a runtime Tag, exactly the shape db/lib/depotCrates.js mints
// for a Depot shipment — `custom: true` and a `custom-` slug, so db:prune-tags
// leaves it alone and no docs/tags.yaml sync can upsert over it. It is an
// ordinary CONSUMABLE, which is what makes unpacking free: the Consume button
// already on the sheet opens it, and the Depot's own openCrate (which lives on
// /depot, out of reach of a Banneret in the Marshes) is not needed.
async function packageItemsRequestImpl({ lines: rawLines, label: rawLabel, reason: rawReason }) {
  const { session, character } = await requireCharacter();
  const reason = requireReason(rawReason);

  const label = String(rawLabel ?? "").trim().slice(0, PACKAGE_LABEL_MAX);
  if (!label) throw new UserError("Say what's in it. ‡");

  const lines = (Array.isArray(rawLines) ? rawLines : [])
    .map((l) => ({ tagId: String(l?.tagId ?? ""), quantity: Math.max(1, Math.trunc(Number(l?.quantity) || 1)) }))
    .filter((l) => l.tagId);
  if (lines.length === 0) throw new UserError("Nothing selected. ‡");

  if (!(await hasEquipmentInReach(prisma, character, PACKAGING_EQUIPMENT_SLUG))) {
    throw new UserError("There's no packaging equipment here. ‡");
  }

  // Resolved against what they ACTUALLY hold, never against what was posted.
  const held = character.tags.filter((ct) => lines.some((l) => l.tagId === ct.tagId));
  const contents = lines.map((line) => {
    const row = held.find((ct) => ct.tagId === line.tagId);
    if (!row) throw new UserError("You aren't carrying that. ‡");
    if (!isTradeable(row.tag)) throw new UserError("That isn't something that can be packed. ‡");
    // A crate of crates would nest a consumesInto chain arbitrarily deep, and
    // halving twice is a free carry exploit besides.
    if (isCrate(row.tag)) throw new UserError("You can't crate a crate. ‡");
    const quantity = Math.min(line.quantity, row.quantity);
    return { tagId: row.tagId, slug: row.tag.slug, name: row.tag.name, quantity, weightLbs: row.tag.weightLbs ?? 0 };
  });

  const innerLbs = contents.reduce((sum, c) => sum + c.weightLbs * c.quantity, 0);
  if (innerLbs > PACKAGE_MAX_LBS) {
    throw new UserError(`A crate holds ${PACKAGE_MAX_LBS} lb. That's ${Math.round(innerLbs)}. ‡`);
  }
  // A second cap, on COUNT rather than weight, because the weight cap does not
  // bound the weightless: `consumesInto` repeats a slug per unit, so a crate of
  // obols (0 lb, stackable, no ceiling) would write an array as long as the
  // pile. The number is generous enough that nobody packing real cargo will
  // ever see it.
  const units = contents.reduce((sum, c) => sum + c.quantity, 0);
  if (units > PACKAGE_MAX_UNITS) {
    throw new UserError(`A crate holds ${PACKAGE_MAX_UNITS} things. That's ${units}. ‡`);
  }

  const weightByTagId = new Map(contents.map((c) => [c.tagId, c.weightLbs]));
  const group = await prisma.tagGroup.findUnique({ where: { slug: "items-gear" } });
  const openTurn = await getOpenTurn();

  // The "custom-" prefix every runtime tag uses, plus enough entropy that two
  // people packing in the same tick cannot collide on the unique slug.
  const slug = `custom-crate-${character.id.slice(-6)}-${Date.now().toString(36)}`;

  let crate;
  await prisma.$transaction(async (tx) => {
    crate = await tx.tag.create({
      data: {
        slug,
        name: "Crate",
        description: `[CONTAINS]: ${label}`,
        custom: true,
        // Game state, not catalog — a Restart Game sweeps it up (TAGS.md §5d).
        ephemeral: true,
        category: "items",
        groupId: group?.id ?? null,
        pointCost: 0,
        tradeable: true,
        stackable: false,
        // The COLUMN is inspectVisibility; `visible:` is only the name
        // docs/tags.yaml uses, and passing it here throws an unknown-argument
        // error whose message points at `groupId` rather than at the real
        // culprit. A crate is a box somebody is visibly hauling.
        inspectVisibility: "ALWAYS",
        weightLbs: crateWeight(contents, weightByTagId),
        removable: false,
        consumable: true,
        // Repeated per unit — that is how consumesInto expresses a quantity
        // (docs/tags.yaml header), and every packable thing worth crating in
        // bulk is stackable.
        consumesInto: contents.flatMap((c) => Array(c.quantity).fill(c.slug)),
        // Carried too, for parity with a Depot crate, so anything that reads
        // one manifest reads both.
        crateContents: contents.map((c) => ({ tagId: c.tagId, name: c.name, quantity: c.quantity })),
      },
    });

    for (const c of contents) await dropCharacterTag(tx, character.id, c.tagId, c.quantity);
    await addToStack(tx, character.id, crate.id, 1, { source: "EVENT", stackable: false });

    const effect = {
      crateTagId: crate.id,
      crateName: crate.name,
      label,
      weightLbs: crate.weightLbs,
      innerLbs,
      contents,
    };
    await createRequest(tx, {
      characterId: character.id,
      turnId: openTurn?.id ?? null,
      type: "PACKAGE_ITEMS",
      reason,
      payload: { lines, label },
      effect,
    });
    await logRequest(tx, {
      actorDiscordUserId: session.discordUserId,
      actionType: "request_package_items",
      targetCharacterId: character.id,
      reason,
      details: effect,
    });
  });

  await afterInventoryChange([character.id]);
  revalidateAll();
  return { name: crate.name, weightLbs: crate.weightLbs, innerLbs };
}

// --- public surface ---------------------------------------------------

// Each action is wrapped so validation comes back as { ok: false, error }
// instead of being thrown — see web/lib/actionResult.js.

export async function craftRequest(input) {
  return guarded(() => craftRequestImpl(input));
}

export async function continueCraft(input) {
  return guarded(() => continueCraftImpl(input));
}

export async function cancelCraft(input) {
  return guarded(() => cancelCraftImpl(input));
}

export async function destroyTagRequest(input) {
  return guarded(() => destroyTagRequestImpl(input));
}

export async function learnRequest(input) {
  return guarded(() => learnRequestImpl(input));
}

export async function teachRequest(input) {
  return guarded(() => teachRequestImpl(input));
}

export async function transferRequest(input) {
  return guarded(() => transferRequestImpl(input));
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

export async function butcherCorpseRequest(input) {
  return guarded(() => butcherCorpseRequestImpl(input));
}

export async function engraveHeadstoneRequest(input) {
  return guarded(() => engraveHeadstoneRequestImpl(input));
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
async function birdMessageRequestImpl({ recipientId, guessedZoneId, tagId: rawTagId }) {
  const { session, character } = await requireCharacter();

  if (!holdsBirdAndLetters(character.tags)) {
    throw new UserError("You need a bird, and you need to be able to write. ‡");
  }

  // The bird carries an OBJECT now. Resolved against what they actually hold,
  // never against what was posted. See docs/systemdocs/PAPERWORK.md.
  const held = character.tags.find((ct) => ct.tagId === String(rawTagId ?? ""));
  if (!held) throw new UserError("You aren't holding that. ‡");
  const kind = held.tag.paperKind;
  if (kind !== "PAPER" && kind !== "SEALED") {
    throw new UserError("A bird carries letters, not that. ‡");
  }
  if (kind === "PAPER" && !(held.tag.paperText ?? "").trim()) {
    throw new UserError("There's nothing written on it. ‡");
  }

  // A snapshot for the GM desk, so a letter that is later resealed, torn up or
  // wiped still has a record of what went. Null on a sealed one: the bird did
  // not open it and neither does this.
  const body = kind === "SEALED" ? null : held.tag.paperText.trim();

  // The only Request with no reason box — the letter IS the record, clipped
  // to what the Request/AuditLog reason columns hold.
  const reason = (body ?? `Sealed: ${held.tag.name}`).slice(0, MAX_REASON_LENGTH);

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
  // Only whether they can WRITE BACK. Reading the letter is no longer this
  // action's business — the paper is the letter, and whether they can read it
  // is answered every time they look at it (db/lib/paper.js).
  const recipientIsLiterate = canReadLetters(recipient.tags);

  // In-game DAY, not a turn id — two turns run per day, and keying on the
  // turn would hand out two letters a day. (The mount's claim shared this trap
  // until it became a per-turn allowance — CARRY.md §2a.)
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
        tagId: held.tagId,
        tagName: held.tag.name,
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
      payload: { recipientId: recipient.id, guessedZoneId: guessedZone.id, tagId: held.tagId },
      effect: {
        birdMessageId: row.id,
        recipientId: recipient.id,
        recipientName: recipient.name,
        guessedZoneId: guessedZone.id,
        guessedZoneName: guessedZone.name,
        tagId: held.tagId,
        tagName: held.tag.name,
        // What was written, for the desk. Null on a sealed letter.
        body,
        delivered,
        previousBirdTurnId: character.birdTurnId ?? null,
      },
    });
    // THE LETTER ONLY LEAVES YOUR HANDS IF IT ARRIVES. A wrong guess means the
    // bird comes back with it still tied on, and the sender is told a turn
    // later like always. Burning a player's letter as the price of a bad guess
    // would be a second punishment nobody was warned about — and the guess
    // already costs them the day's send.
    if (delivered) {
      await dropCharacterTag(tx, character.id, held.tagId, 1);
      await addToStack(tx, recipient.id, held.tagId, 1, {});
    }

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
    sentReceiptDm({ recipientName: recipient.name, zoneName: guessedZone.name, letterName: held.tag.name }),
    { source: "bird" },
  );
  if (delivered) {
    notifyCharacter(
      recipient,
      deliveryDm({ senderName: character.name, letterName: held.tag.name }),
      {
        // No Reply button for someone who can't write one — birdReply.js
        // re-checks, since a GM can strip the tag inside the window.
        components: recipientIsLiterate ? replyButtonRow(birdMessageId) : undefined,
        meta: { kind: "bird", birdMessageId, letterName: held.tag.name },
        source: "bird",
      },
    );
    await afterInventoryChange([character.id, recipient.id]);
  }

  revalidateAll();
  return { ok: true };
}

export async function extractGodfleshRequest(input) {
  return guarded(() => extractGodfleshRequestImpl(input));
}

export async function packageItemsRequest(input) {
  return guarded(() => packageItemsRequestImpl(input));
}

export async function birdMessageRequest(input) {
  return guarded(() => birdMessageRequestImpl(input));
}
