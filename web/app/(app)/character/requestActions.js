"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma, isDynastyHead, isDynastyMember } from "@lifeweb/db";
import { moodTagSlug, moodLabel, MOOD_SLUGS } from "@lifeweb/db/lib/mood";
import { auth } from "@/lib/auth";
import { getOpenTurn } from "@/lib/turn";
import { createRequest, logRequest, requireReason } from "@/lib/requests";
import { UserError, guarded } from "@/lib/actionResult";
import { expiryFor } from "@/lib/turnFormat";
import { FEAR_PENALTY, FEAR_MAX_LENGTH } from "@/lib/constants";
import { TRANSFERABLE_CATEGORIES } from "@/lib/tagRequests";
import {
  tagsById as buildTagsById,
  requirementSatisfied,
  chainSiblingsToRemove,
  heldHigherTiers,
} from "@/lib/characterCreation";
import { addToStack, debitResources, dropCharacterTag, grantTagSlugs, moveResources } from "@/lib/requestEffects";
import {
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
import { syncCharacterNarrowcastAccess, syncCharacterNickname, ensureCharacterRole } from "@/lib/discordGuild";
import { NAME_LIMITS, formatCharacterName, formatBareName, normalizeHonorific } from "@/lib/characterName";
import { propagateDynastyLastName } from "@/lib/dynasty";

// The only sanctioned way a name changes after creation (CHARACTERS.md §1b).
const MULLIGAN_POTION_SLUG = "mulligan-potion";

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
  revalidatePath("/gm/turns");
  revalidatePath("/gm/audit");
}

function parseCount(raw, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const n = Number.parseInt(raw ?? "", 10);
  if (!Number.isFinite(n) || n < min || n > max) return null;
  return n;
}

// --- Mood -------------------------------------------------------------

async function setMoodRequestImpl({ mood, reason: rawReason }) {
  const { session, character } = await requireCharacter();
  const reason = requireReason(rawReason);
  if (!["NEUTRAL", "HAPPY", "UNHAPPY"].includes(mood)) throw new UserError("Unknown mood.");

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
  if (slug && !target) throw new UserError("Mood tags are missing — run npm run db:sync-tags.");

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
  return { mood: moodLabel(mood) };
}

// --- Resources --------------------------------------------------------

// "character:<id>" / "faction:<id>" on both ends. Per the design call, the
// SOURCE may be any faction silo or any living player — a player can pull
// resources to themselves and justify it in the reason, and a GM undoes it if
// that was a lie. That's the whole bet of the Requests system.
//
// What the source may NOT be is somewhere else: see web/lib/transferReach.js.
// The bet is that you'll explain yourself afterwards, not that you can do it
// from across the map. Location and zone come back on every party so the
// caller can ask.
async function resolveParty(key, { allowDead = false } = {}) {
  const [kind, id] = (key ?? "").split(":");
  // A server action is a public endpoint, and a posted key of just
  // "character" -- no colon, no id -- used to leave `id` undefined. Prisma
  // DELETES an undefined field from a where clause rather than matching
  // nothing, so "find the character with this id" quietly became "find any
  // living character", and the transfer or the heal then ran against whoever
  // came back first. `?? ""` matches nobody, which is the answer a malformed
  // key deserves.
  if (!id) return null;
  if (kind === "character") {
    // Looting is the one path that walks past the ALIVE filter — a corpse is
    // still a "party" whose ⬢ someone else can pull. Every other caller (SEND
    // transfer, healing payer, faction silo authority) leaves the flag off
    // and gets the original ALIVE-only lookup.
    const statusFilter = allowDead ? { in: ["ALIVE", "DEAD"] } : "ALIVE";
    const c = await prisma.character.findFirst({
      where: { id: id ?? "", status: statusFilter },
      select: { id: true, name: true, resources: true, locationId: true, zoneId: true, status: true },
    });
    return c
      ? { kind, id: c.id, name: c.name, balance: c.resources, locationId: c.locationId, zoneId: c.zoneId, status: c.status }
      : null;
  }
  if (kind === "faction") {
    const f = await prisma.faction.findUnique({
      where: { id: id ?? "" },
      select: { id: true, name: true, silo: true, zoneId: true, zone: { select: { name: true } } },
    });
    if (!f || f.name === "Unaffiliated") return null;
    return { kind, id: f.id, name: f.name, balance: f.silo, zoneId: f.zoneId, zoneName: f.zone?.name ?? null };
  }
  return null;
}

async function transferResourcesRequestImpl({ fromKey, toKey, amount: rawAmount, direction: rawDirection, reason: rawReason }) {
  const { session, character } = await requireCharacter();
  const reason = requireReason(rawReason);
  const direction = rawDirection === "LOOT" ? "LOOT" : "SEND";
  const isLoot = direction === "LOOT";

  const amount = parseCount(rawAmount, { min: 1 });
  if (amount == null) throw new UserError("Amount must be a positive whole number.");

  // Looting a corpse: the source has to be a DEAD character in the same room,
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
    if (!character.locationId || from.locationId !== character.locationId) {
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
  // Loot has its own reach check above (same room as the corpse), so the
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
  // The ledger still records the real direction: `delta` is carried with each
  // party, so sorting only changes the order the two updates are issued in.
  const legs = [
    [from, -amount],
    [to, amount],
  ].sort(([a], [b]) => (a.kind === b.kind ? a.id.localeCompare(b.id) : a.kind.localeCompare(b.kind)));

  await prisma.$transaction(async (tx) => {
    for (const [party, delta] of legs) {
      // moveResources refuses a debit the balance no longer covers, which
      // aborts the whole transaction. The `amount > from.balance` check above
      // is the friendly message; this is the one that two simultaneous
      // transfers cannot both pass.
      await moveResources(tx, party, delta);
      if (party.kind === "faction") {
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

  revalidateAll();
  return {};
}

// --- Tags -------------------------------------------------------------

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
    include: { group: { select: { requiredTagId: true } } },
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

  // Both prerequisites the point-buy menu enforces, enforced here too: the
  // per-tag requiredTag, and the group gate that hides a whole category
  // (Demoness, Bacchus). Without this the menu's filtering is decorative —
  // a hand-posted request would walk straight into a hidden category.
  //
  // The whole catalog's ids/parents come down (~80 rows) so a chain walk
  // never dead-ends on an ancestor the character doesn't hold, same reason
  // createCharacter does it.
  const chainRows = await prisma.tag.findMany({ select: { id: true, parentTagId: true } });
  const chainById = buildTagsById(chainRows);
  const heldIds = character.tags.map((ct) => ct.tagId);
  if (!requirementSatisfied(tag, chainById, heldIds)) {
    throw new UserError("You're missing a prerequisite for that tag.");
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

  await prisma.$transaction(async (tx) => {
    await dropCharacterTag(tx, character.id, tagId, quantity);
    if (resourcesSpent) {
      await moveResources(tx, { kind: "character", id: character.id, name: character.name }, -resourcesSpent);
    }
    await createRequest(tx, {
      characterId: character.id,
      turnId: openTurn?.id ?? null,
      type: "REMOVE_TAG",
      reason,
      payload: { tagId, quantity, resourcesSpent },
      effect: { tagId, tagName: held.tag.name, quantity, resourcesSpent, restore },
    });
    await logRequest(tx, {
      actorDiscordUserId: session.discordUserId,
      actionType: "request_remove_tag",
      targetCharacterId: character.id,
      reason,
      details: { tagId, tagName: held.tag.name, quantity, resourcesSpent },
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
  // snapshot below, never re-deriving from the catalog.
  const { slugs: grantSlugs, durations: grantDurations } = resolveConsumeGrants(
    held.tag,
    heldSlugsOf(character.tags),
  );

  await prisma.$transaction(async (tx) => {
    await dropCharacterTag(tx, character.id, tagId, 1);
    const granted = await grantTagSlugs(
      tx,
      character.id,
      grantSlugs,
      openTurn?.number ?? null,
      grantDurations,
    );
    await createRequest(tx, {
      characterId: character.id,
      turnId: openTurn?.id ?? null,
      type: "CONSUME_TAG",
      reason,
      payload: { tagId },
      effect: { tagId, tagName: held.tag.name, restore, granted },
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
      },
    });
  });

  // Both the tag consumed and anything it became can gate #watch/#intercom.
  await syncCharacterNarrowcastAccess(character.id).catch(() => {});
  revalidateAll();
  return {};
}

// SEND is the ordinary path — the initiator hands their own Item/Asset to
// someone in the room. LOOT is its inverse: the counterparty is a corpse
// standing in the same location, and the initiator pulls the item off it.
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

  if (!character.locationId) {
    throw new UserError(
      isLoot ? "You aren't anywhere you could pick that up." : "You aren't anywhere you could hand that over.",
    );
  }
  if (toCharacterId === character.id) throw new UserError("That's you.");

  // In SEND the initiator IS the source; in LOOT the counterparty is. Both
  // roles need the eager-loaded tag row so we can size the stack, look at
  // expiry, and read the category gate off the catalog side.
  let source;
  if (isLoot) {
    // A corpse in the same room. Folded into the WHERE clause the same way
    // the recipient check used to be, so a corpse that gets moved (a Revive
    // between page load and submit) fails closed and nothing is written.
    const corpse = await prisma.character.findFirst({
      where: { id: toCharacterId ?? "", status: "DEAD", locationId: character.locationId },
      select: {
        id: true,
        name: true,
        tags: {
          where: { tagId },
          select: {
            tagId: true,
            quantity: true,
            source: true,
            expiresTurn: true,
            tag: { select: { name: true, category: true, stackable: true } },
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

  if (!TRANSFERABLE_CATEGORIES.includes(source.tag.category)) {
    throw new UserError(
      isLoot ? "Only Items and Assets can be taken." : "Only Items and Assets can be handed over.",
    );
  }

  // Capped at what the source actually holds, so a hand-crafted request can't
  // mint items out of a stack that isn't there.
  const quantity = source.tag.stackable
    ? parseCount(rawQuantity, { min: 1, max: source.quantity }) ?? 1
    : source.quantity;

  // The RECIPIENT side. For SEND: pick a living character in the same room.
  // For LOOT: the initiator receives.
  let recipient;
  if (isLoot) {
    recipient = { id: character.id, name: character.name };
  } else {
    // Same room, same as ⬢ — handing someone a sword across the map was the
    // obvious way around the transfer gate. Folded into the WHERE clause
    // rather than done as a second read (the idiom heal uses, REQUESTS.md
    // §5c), so a recipient who walks out between page load and submit fails
    // closed and nothing is written.
    recipient = await prisma.character.findFirst({
      // `?? ""` for the same reason as resolveParty above: an omitted id
      // would otherwise be stripped from the where clause and hand the item
      // to whoever happened to be standing in the room.
      where: { id: toCharacterId ?? "", status: "ALIVE", locationId: character.locationId },
      select: { id: true, name: true },
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
// must hold a Medical skill, the patient must be standing in the medic's
// Location, and the affliction's own requirementSkills must be satisfied. The
// PAYER is deliberately ungated beyond being present — any co-located player
// or any faction Silo, same bet as TRANSFER_RESOURCES.
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
    where: { id: targetCharacterId ?? "", status: "ALIVE", locationId: character.locationId },
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
  // A person has to be in the room; a Silo has to be in reach. A Silo used to
  // pay from anywhere, which became a laundering hole the moment transfers
  // grew a reach gate — bill a distant Silo for a cure and the ⬢ has moved
  // across the map without anyone carrying it.
  if (payer.kind === "character") {
    const present = await prisma.character.count({
      where: { id: payer.id, status: "ALIVE", locationId: character.locationId },
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

  await prisma.$transaction(async (tx) => {
    // A spend, not a transfer: the cost leaves the payer and goes nowhere.
    await debitResources(tx, payer, cost, ledger);
    await dropCharacterTag(tx, target.id, held.tagId);
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
  revalidateAll();
  return { targetName: target.name, tagName: held.tag.name, cost };
}

// --- Desires ----------------------------------------------------------

// Setting and cancelling are NOT requests — nothing has been granted yet, so
// there's nothing for a GM to undo. Only fulfilling one moves Tag Points and
// therefore needs a reason and a review.
async function setDesireImpl({ text: rawText, points: rawPoints }) {
  const { session, character } = await requireCharacter();

  const text = rawText?.toString().trim();
  if (!text) throw new UserError("Describe your Desire.");
  const points = parseCount(rawPoints, { min: DESIRE_MIN_POINTS, max: DESIRE_MAX_POINTS });
  if (points == null) throw new UserError(`Points must be between ${DESIRE_MIN_POINTS} and ${DESIRE_MAX_POINTS}.`);

  const openTurn = await getOpenTurn();
  const [active, lastEnded] = await Promise.all([
    prisma.desire.findFirst({ where: { characterId: character.id, status: "ACTIVE" } }),
    prisma.desire.findFirst({
      where: { characterId: character.id, status: { in: ["FULFILLED", "CANCELLED"] } },
      orderBy: { updatedAt: "desc" },
    }),
  ]);
  if (active) throw new UserError("You already have an active Desire.");
  if (openTurn && lastEnded?.endedTurnNumber != null && openTurn.number <= lastEnded.endedTurnNumber) {
    throw new UserError("You're on cooldown — you can set a new Desire next turn.");
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
  return {};
}

async function cancelDesireImpl() {
  const { session, character } = await requireCharacter();
  const openTurn = await getOpenTurn();

  const active = await prisma.desire.findFirst({ where: { characterId: character.id, status: "ACTIVE" } });
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
      details: { desireId: active.id },
    },
  });

  revalidatePath("/character");
  return {};
}

async function fulfillDesireRequestImpl({ reason: rawReason }) {
  const { session, character } = await requireCharacter();
  const reason = requireReason(rawReason);

  const openTurn = await getOpenTurn();
  const active = await prisma.desire.findFirst({ where: { characterId: character.id, status: "ACTIVE" } });
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

  // Outside the transaction: the transcript row isn't part of the effect being
  // applied, and db/lib/archive.js swallows its own failures.
  await recordArchiveEvent({
    kind: "DESIRE_FULFILLED",
    character,
    locationId: character.locationId ?? null,
    turn: openTurn,
    content: `${character.name} fulfilled a Desire: ${active.text}`,
  });

  revalidateAll();
  return {};
}

// --- Fear -------------------------------------------------------

// One persistent, self-set dread per character. Unlike a Desire it is NOT
// consumed by being fulfilled and has no ACTIVE/ENDED lifecycle — see the
// Character model comment in schema.prisma.
//
// Two write paths, deliberately: the FIRST set is free (nothing has been
// granted, so there is nothing for a GM to undo — the same reasoning that
// keeps setDesire out of the Requests system), while CHANGING a fear that is
// already locked in is a request that lands immediately and is reviewed after.
async function setWorstFearImpl({ text: rawText }) {
  const { session, character } = await requireCharacter();

  const text = rawText?.toString().trim().slice(0, FEAR_MAX_LENGTH);
  if (!text) throw new UserError("Describe your Fear.");
  if (character.fear) {
    throw new UserError("You already have a Fear — changing it takes a request.");
  }

  const openTurn = await getOpenTurn();

  await prisma.character.update({
    where: { id: character.id },
    data: { fear: text, fearSetTurnNumber: openTurn?.number ?? null },
  });
  await prisma.auditLog.create({
    data: {
      actorDiscordUserId: session.discordUserId,
      actionType: "worst_fear_set",
      targetCharacterId: character.id,
      details: { text },
    },
  });

  revalidatePath("/character");
  return {};
}

async function changeWorstFearRequestImpl({ text: rawText, reason: rawReason }) {
  const { session, character } = await requireCharacter();
  const reason = requireReason(rawReason);

  const text = rawText?.toString().trim().slice(0, FEAR_MAX_LENGTH);
  if (!text) throw new UserError("Describe your Fear.");
  if (!character.fear) throw new UserError("You haven't set a Fear yet.");
  if (text === character.fear) throw new UserError("That's already your Fear.");

  const openTurn = await getOpenTurn();
  // Snapshot before overwriting — Undo puts the previous wording back rather
  // than re-deriving anything from the sheet.
  const previousText = character.fear;
  const previousSetTurnNumber = character.fearSetTurnNumber ?? null;
  const setTurnNumber = openTurn?.number ?? null;

  await prisma.$transaction(async (tx) => {
    await tx.character.update({
      where: { id: character.id },
      data: { fear: text, fearSetTurnNumber: setTurnNumber },
    });
    await createRequest(tx, {
      characterId: character.id,
      turnId: openTurn?.id ?? null,
      type: "CHANGE_FEAR",
      reason,
      payload: { text },
      effect: { text, setTurnNumber, previousText, previousSetTurnNumber },
    });
    await logRequest(tx, {
      actorDiscordUserId: session.discordUserId,
      actionType: "request_change_worst_fear",
      targetCharacterId: character.id,
      reason,
      details: { text, previousText },
    });
  });

  revalidateAll();
  return {};
}

// The fear coming true: a flat FEAR_PENALTY off the balance, never a
// ladder. The fear is NOT consumed — the same fear stands and can come true
// again next turn, which is the whole reason this stamps a turn number
// instead of flipping a status.
async function fulfillWorstFearRequestImpl({ reason: rawReason }) {
  const { session, character } = await requireCharacter();
  const reason = requireReason(rawReason);

  if (!character.fear) throw new UserError("You haven't set a Fear.");

  // The cooldown is turn-keyed, so there has to be a turn to key it to.
  // Stamping null would silently clear an existing cooldown. Desire tolerates
  // a null turn because setting one isn't a request; this is, so it refuses.
  const openTurn = await getOpenTurn();
  if (!openTurn) throw new UserError("No turn is open.");

  // Fulfilled on turn 5: blocked on 5, allowed from 6.
  const previousLastFulfilledTurn = character.fearLastFulfilledTurn ?? null;
  if (previousLastFulfilledTurn != null && openTurn.number <= previousLastFulfilledTurn) {
    throw new UserError(
      "Your Fear already came true this turn — you can claim it again next turn.",
    );
  }

  await prisma.$transaction(async (tx) => {
    // Deliberately allowed to go negative, the mirror of undoing a fulfilled
    // Desire: the penalty is the point, and clamping at 0 would let a broke
    // player dodge it entirely.
    await tx.character.update({
      where: { id: character.id },
      data: {
        tagPoints: { decrement: FEAR_PENALTY },
        fearLastFulfilledTurn: openTurn.number,
      },
    });
    await createRequest(tx, {
      characterId: character.id,
      turnId: openTurn.id,
      type: "FULFILL_FEAR",
      reason,
      payload: {},
      // fearText is snapshotted so the GM panel shows what was claimed even
      // if the player rewords the fear before it's reviewed.
      effect: {
        fearText: character.fear,
        pointsDeducted: FEAR_PENALTY,
        fulfilledTurnNumber: openTurn.number,
        previousLastFulfilledTurn,
      },
    });
    await logRequest(tx, {
      actorDiscordUserId: session.discordUserId,
      actionType: "request_fulfill_worst_fear",
      targetCharacterId: character.id,
      reason,
      details: { fearText: character.fear, pointsDeducted: FEAR_PENALTY },
    });
  });

  await recordArchiveEvent({
    kind: "FEAR_FULFILLED",
    character,
    locationId: character.locationId ?? null,
    turn: openTurn,
    content: `${character.name}'s Fear came true: ${character.fear}`,
  });

  revalidateAll();
  return {};
}

// --- Name ---------------------------------------------------------------

// The one player-facing rename: drinking a Mulligan Potion. Re-validates the
// potion is actually held (the button that opens this dialog is only
// advisory), applies the same allowlist/cap/dynasty-lock rules every other
// writer of Character.name uses, then spends the potion and rewrites the
// name in one transaction. See docs/systemdocs/CHARACTERS.md §1b.
async function changeNameRequestImpl({ honorific: rawHonorific, firstName: rawFirstName, lastName: rawLastName, reason: rawReason }) {
  const { session, character } = await requireCharacter();
  const reason = requireReason(rawReason);

  const held = character.tags.find((ct) => ct.tag.slug === MULLIGAN_POTION_SLUG);
  if (!held) throw new UserError("You need a Mulligan Potion to change your name.");

  const honorific = normalizeHonorific(rawHonorific);
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
  // Snapshot before dropping — Undo restores the original source/expiry of
  // the one potion this took, same idiom as CONSUME_TAG.
  const potionRestore = { source: held.source, expiresTurn: held.expiresTurn, quantity: 1 };

  let updated;
  await prisma.$transaction(async (tx) => {
    await dropCharacterTag(tx, character.id, held.tagId, 1);
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
      effect: { previous, next, potionTagId: held.tagId, potionRestore },
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

// --- public surface ---------------------------------------------------

// Each action is wrapped so validation comes back as { ok: false, error }
// instead of being thrown — see web/lib/actionResult.js for why throwing is
// invisible to the player in a production build.

export async function setMoodRequest(input) {
  return guarded(() => setMoodRequestImpl(input));
}

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

export async function cancelDesire() {
  return guarded(() => cancelDesireImpl());
}

export async function fulfillDesireRequest(input) {
  return guarded(() => fulfillDesireRequestImpl(input));
}

export async function setWorstFear(input) {
  return guarded(() => setWorstFearImpl(input));
}

export async function changeWorstFearRequest(input) {
  return guarded(() => changeWorstFearRequestImpl(input));
}

export async function fulfillWorstFearRequest(input) {
  return guarded(() => fulfillWorstFearRequestImpl(input));
}

export async function changeNameRequest(input) {
  return guarded(() => changeNameRequestImpl(input));
}
