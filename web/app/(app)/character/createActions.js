"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  prisma,
  roleCapacity,
  seatHolderStatuses,
  isDynastyHead,
  isDynastyMember,
  normalizeAntagonistSlugs,
} from "@lifeweb/db";
import { auth } from "@/lib/auth";
import { dynastyLastName, propagateDynastyLastName } from "@/lib/dynasty";
import { isSuperadmin } from "@/lib/superadmin";
import { expiryForGrant } from "@lifeweb/db/lib/grantExpiry";
import {
  syncCharacterNickname,
  ensureCharacterRole,
  syncCharacterZoneRole,
  syncCharacterNarrowcastAccess,
  getGuildMember,
  isCursed,
  isApprovedPlayer,
  isLeaderWhitelisted,
  removeCursedRole,
} from "@/lib/discordGuild";
import {
  computeBudget,
  isPlaytestLocked,
  isRoleSelectable,
  tagsById as buildTagsById,
  effectiveTotalCost,
  negativeTagCount,
  DEFAULT_MAX_DRAWBACK_TAGS,
  chainSiblingsToRemove,
  heldHigherTiers,
  requirementSatisfied,
  exclusiveConflict,
  conflictingTag,
  CURSED_ROLE_SLUGS,
} from "@/lib/characterCreation";

import { reserveRole, releaseRole } from "@lifeweb/db/lib/roleReservation";
import { recordArchiveEvent } from "@/lib/archive";
import {
  AGE_MIN,
  AGE_MAX,
  NAME_LIMITS,
  formatCharacterName,
  formatBareName,
  normalizeEarnedHonorific,
  GENDERS,
} from "@/lib/characterName";

// Creates a character from the wizard's Confirm step. Everything posted is
// re-derived and re-checked — a server action is a public endpoint.
//
// The seat-cap recheck closes a real race (Prisma READ COMMITTED); the
// `FOR UPDATE` row lock on Role is what actually serializes it.
export async function createCharacter(formData) {
  const session = await auth();
  if (!session?.discordUserId) redirect("/");
  const discordUserId = session.discordUserId;

  const part = (key, limit) => formData.get(key)?.toString().trim().slice(0, limit) || null;
  // `title` is GM-granted only — not read here. `honorific` is read but
  // gated further down, once role and tags are both known.
  const rawHonorific = formData.get("honorific");
  // gender is a closed enum — junk lands as NEUTRAL. A locked seat
  // overwrites it once the role is known.
  const postedGender = formData.get("gender")?.toString();
  const gender = GENDERS.includes(postedGender) ? postedGender : "NEUTRAL";
  const firstName = part("firstName", NAME_LIMITS.firstName);
  // Not const: a locked-seat role overwrites this once known, below.
  let lastName = part("lastName", NAME_LIMITS.lastName);
  const rawAge = Number.parseInt(formData.get("age")?.toString() ?? "", 10);
  const age =
    Number.isInteger(rawAge) && rawAge >= AGE_MIN && rawAge <= AGE_MAX ? rawAge : null;
  const roleId = formData.get("roleId")?.toString();
  const tagIds = formData.getAll("tagIds").map((t) => t.toString()).filter(Boolean);
  // Consent for secretly-assigned antagonist seats; normalizeAntagonistSlugs
  // is the boundary that keeps junk slugs out of the column.
  const antagonistOptIns = normalizeAntagonistSlugs(formData.getAll("antagonistOptIns"));

  if (!firstName) return { error: "Your character needs a first name." };
  // One word each — the wizard gates this too, but the form can be hand-posted.
  if (/\s/.test(firstName) || /\s/.test(lastName ?? "")) {
    return { error: "First and last names are one word each." };
  }
  if (!roleId) return { error: "Pick a role before confirming." };

  if (await prisma.character.findFirst({ where: { discordUserId, status: "ALIVE" } })) {
    redirect("/character");
  }

  const [role, config, member, openTurn] = await Promise.all([
    // Zone comes along for the playtest lock below (no Windlander column).
    prisma.role.findUnique({
      where: { id: roleId },
      include: { faction: { include: { zone: true } }, startingZone: true },
    }),
    prisma.gameConfig.findUnique({ where: { id: 1 } }),
    getGuildMember(discordUserId),
    prisma.turn.findFirst({ where: { status: "OPEN" }, select: { number: true } }),
  ]);
  if (!role) return { error: "That role no longer exists." };

  // Launch gate: game must be open AND this member approved — the real
  // enforcement boundary, not the wizard's UI. Superadmin bypasses both.
  const bypass = isSuperadmin(discordUserId);
  if (!bypass && !config?.openToPlayers) {
    return { error: "Ravenheart isn't open yet. Character creation opens when the game begins." };
  }
  if (!bypass && !isApprovedPlayer(member)) {
    return { error: "You aren't on the roster for this game. Ask a GM if you think that's wrong." };
  }

  // Playtest lock from /gm/dev, outside `bypass` on purpose — the host is
  // locked out too (characterCreation.js).
  const playtestLocked =
    config?.playtestModeEnabled === true &&
    isPlaytestLocked({ role, zoneName: role.faction?.zone?.name });
  if (playtestLocked) {
    return { error: "That role is closed for this playtest." };
  }

  // Split so each rejection gets its own message. `=== false` rather than
  // falsy: no config row leaves the whitelist enforced.
  const leaderWhitelisted =
    bypass || config?.leaderWhitelistEnabled === false || isLeaderWhitelisted(member);
  if (role.grantsLeader && !leaderWhitelisted) {
    return { error: "That role isn't available to you." };
  }

  const cursed = isCursed(member);
  if (!isRoleSelectable({ role, cursed, leaderWhitelisted })) {
    return { error: `While cursed you may only return as ${CURSED_ROLE_SLUGS.join(" or ")}.` };
  }

  // Dynasty seats wear the Baron's last name, never what was typed — not
  // reading the form is the lock. Null until a Baron exists.
  if (isDynastyMember(role.slug)) lastName = await dynastyLastName();

  // Dynasty seats also fix gender — taking the seat's value is the lock.
  const effectiveGender = role.lockedGender ?? gender;

  // Selected tags must actually be buyable — a hand-posted request could
  // otherwise name a 0-cost, non-purchasable tag like Nobility.
  const selected = tagIds.length
    ? await prisma.tag.findMany({
        where: { id: { in: tagIds }, purchasable: true },
        // requiredTagId is the hidden-category gate requirementSatisfied()
        // checks below.
        include: { group: { select: { requiredTagId: true } } },
      })
    : [];
  if (selected.length !== tagIds.length) {
    return { error: "One of those tags isn't available for purchase." };
  }

  // Role tags come from the catalog by name (roles.yaml, validated by db:sync-roles).
  const startingTags = role.startingTagSlugs.length
    ? await prisma.tag.findMany({ where: { name: { in: role.startingTagSlugs } } })
    : [];

  // A word this character has no claim to lands as null, not a failed create.
  const honorific = normalizeEarnedHonorific(rawHonorific, {
    tagSlugs: [...selected, ...startingTags].map((t) => t.slug),
    roleSlug: role.slug,
    gender: effectiveGender,
  });
  const name = formatCharacterName({ honorific, firstName, title: null, lastName });

  // The full catalog, not just what's selected/granted, so a chain walk
  // (parentTagId) never dead-ends on an ancestor the client didn't send.
  const allTags = await prisma.tag.findMany({
    // name/exclusive ride along for the exclusivity check; conflictsWith is
    // what conflictingTag() reads.
    select: {
      id: true,
      name: true,
      pointCost: true,
      parentTagId: true,
      requiredTagId: true,
      exclusive: true,
      groupId: true,
      conflictsWith: { select: { id: true } },
    },
  });
  const byId = buildTagsById(
    allTags.map((t) => ({ ...t, conflictsWithIds: t.conflictsWith.map((c) => c.id) })),
  );
  const grantedIds = startingTags.map((t) => t.id);

  // Guards against a hand-posted request submitting two chain tiers at
  // once, or buying below a tier the role already grants.
  for (const tag of selected) {
    if (chainSiblingsToRemove(tag, byId, tagIds).length > 0) {
      return { error: "You can only hold one tier of the same skill chain." };
    }
    if (heldHigherTiers(tag, byId, grantedIds).length > 0) {
      return { error: "Your role already grants a higher tier of that skill chain." };
    }
  }

  // Prerequisites: requiredTag, plus the hidden-category group gate, must
  // be satisfied by something granted or selected.
  const heldOrSelectedIds = [...grantedIds, ...tagIds];
  for (const tag of selected) {
    if (!requirementSatisfied(tag, byId, heldOrSelectedIds)) {
      return { error: "One of those tags is missing a prerequisite." };
    }
  }

  // One exclusive Belief per character — checked against role-granted
  // starting tags too, not just the cart.
  for (const tag of selected) {
    const conflict = exclusiveConflict(tag, heldOrSelectedIds, byId);
    if (conflict) {
      return { error: `${tag.name} and ${conflict.name} can't be held at the same time.` };
    }
  }

  // Named conflict pairs (Sober vs Addiction). Reads the full catalog row
  // (byId), not the bare `tag`, since `selected` omits conflictsWith.
  for (const tag of selected) {
    const catalogTag = byId.get(tag.id) ?? tag;
    const conflict = conflictingTag(catalogTag, heldOrSelectedIds, byId);
    if (conflict) {
      return { error: `${tag.name} conflicts with ${conflict.name}.` };
    }
  }

  // Drawback cap (TAGS.md §4a) counts only bought tags — role-granted
  // starting tags never pass through `selected`.
  const maxDrawbacks = config?.maxDrawbackTags ?? DEFAULT_MAX_DRAWBACK_TAGS;
  const drawbackCount = negativeTagCount(selected);
  if (drawbackCount > maxDrawbacks) {
    return {
      error: `You picked ${drawbackCount} drawbacks and can take at most ${maxDrawbacks}.`,
    };
  }

  const budget = computeBudget({ startingTagPoints: config?.startingTagPoints ?? 0, role, cursed });
  const spent = effectiveTotalCost(selected, byId, grantedIds);
  if (spent > budget) {
    return { error: `That costs ${spent} points and you have ${budget}.` };
  }

  // Union bought + granted tags, refunding nothing (already budget-checked).
  // A tag with a catalog duration must arrive already stamped — nothing
  // else backfills expiresTurn later.
  const tagIdsToGrant = new Map();
  for (const tag of startingTags) {
    const expiresTurn = await expiryForGrant(prisma, tag, openTurn, { where: "createCharacter" });
    tagIdsToGrant.set(tag.id, { source: "GM_GRANT", expiresTurn });
  }
  for (const tag of selected) {
    if (!tagIdsToGrant.has(tag.id)) {
      const expiresTurn = await expiryForGrant(prisma, tag, openTurn, { where: "createCharacter" });
      tagIdsToGrant.set(tag.id, { source: "POINT_BUY", expiresTurn });
    }
    // A purchased higher tier replaces a role-granted lower tier of the same
    // chain — the discount above already paid for exactly one rung.
    for (const lowerId of chainSiblingsToRemove(tag, byId, grantedIds)) {
      tagIdsToGrant.delete(lowerId);
    }
  }

  let created;
  try {
    created = await prisma.$transaction(async (tx) => {
      // The lock that actually closes the race — see the header comment.
      await tx.$queryRaw`SELECT id FROM "Role" WHERE id = ${role.id} FOR UPDATE`;
      const [taken, reservedByOthers] = await Promise.all([
        tx.character.count({ where: { roleId: role.id, status: { in: seatHolderStatuses(role) } } }),
        tx.roleReservation.count({
          where: { roleId: role.id, discordUserId: { not: discordUserId }, expiresAt: { gt: new Date() } },
        }),
      ]);
      if (taken + reservedByOthers >= roleCapacity(role, config?.playerCount ?? 100)) {
        throw new Error("ROLE_FULL");
      }
      // Release the caller's own hold in the same transaction.
      await releaseRole(tx, discordUserId);

      const character = await tx.character.create({
        data: {
          discordUserId,
          honorific,
          firstName,
          title: null,
          lastName,
          name,
          gender: effectiveGender,
          age,
          roleId: role.id,
          roleTitle: role.name,
          factionId: role.factionId,
          zoneId: role.startingZoneId,
          resources: role.startingResources,
          tagPoints: budget - spent,
          isLeader: role.grantsLeader,
          isTreasurer: role.grantsTreasurer,
          antagonistOptIns,
        },
      });

      await tx.characterTag.createMany({
        data: [...tagIdsToGrant].map(([tagId, { source, expiresTurn }]) => ({
          characterId: character.id,
          tagId,
          source,
          expiresTurn,
        })),
      });

      return character;
    });
  } catch (err) {
    if (err.message === "ROLE_FULL") {
      return { error: `${role.name} was taken while you were deciding. Pick another role.` };
    }
    throw err;
  }

  // Discord side effects, best-effort: narrowcast reads the zone/tags just
  // written. Channel access is the zone's own "Zone: {Name}" role, distinct
  // from the character's personal (mentionable name-only) role.
  await ensureCharacterRole(created).catch(() => {});
  if (created.zoneId) {
    await syncCharacterZoneRole(discordUserId, null, created.zoneId).catch(() => {});
  }
  await syncCharacterNickname(discordUserId, formatBareName({ firstName, lastName })).catch(() => {});
  await syncCharacterNarrowcastAccess(created.id).catch(() => {});
  if (cursed) await removeCursedRole(discordUserId).catch(() => {});

  // A new Baron renames every living family member, including one created
  // before a Baron existed. Best-effort — must not cost this create.
  if (isDynastyHead(role.slug)) {
    await propagateDynastyLastName(created.lastName).catch((err) =>
      console.error("propagateDynastyLastName failed:", err),
    );
  }

  await prisma.auditLog.create({
    data: {
      actorDiscordUserId: discordUserId,
      actionType: "character_created",
      targetCharacterId: created.id,
      details: {
        role: role.name,
        faction: role.faction?.name ?? null,
        zone: role.startingZone?.name ?? null,
        budget,
        spent,
        purchased: selected.map((t) => t.name),
        antagonistOptIns,
      },
    },
  });

  await recordArchiveEvent({
    kind: "CHARACTER_CREATED",
    character: created,
    zoneId: created.zoneId ?? null,
    zoneName: role.startingZone?.name ?? null,
    turn: openTurn,
    content: `${created.name} arrived in Ravenheart as ${role.name}.`,
  });

  revalidatePath("/", "layout");
  redirect("/character");
}

// Slides the reservation hold's expiry on each wizard Next. Re-checks the
// same gates createCharacter does — the wizard's UI is a hint, not the
// lock.
export async function reserveRoleAction(roleId) {
  const session = await auth();
  if (!session?.discordUserId) return { error: "Sign in to hold a role." };
  const discordUserId = session.discordUserId;
  if (!roleId) return { error: "Pick a role before continuing." };

  if (await prisma.character.findFirst({ where: { discordUserId, status: "ALIVE" } })) {
    return { error: "You already have a character." };
  }

  const [role, config, member] = await Promise.all([
    prisma.role.findUnique({ where: { id: roleId }, include: { faction: { include: { zone: true } } } }),
    prisma.gameConfig.findUnique({ where: { id: 1 } }),
    getGuildMember(discordUserId),
  ]);
  if (!role) return { error: "That role no longer exists." };

  const bypass = isSuperadmin(discordUserId);
  if (!bypass && !config?.openToPlayers) {
    return { error: "Ravenheart isn't open yet. Character creation opens when the game begins." };
  }
  if (!bypass && !isApprovedPlayer(member)) {
    return { error: "You aren't on the roster for this game. Ask a GM if you think that's wrong." };
  }
  const playtestLocked =
    config?.playtestModeEnabled === true &&
    isPlaytestLocked({ role, zoneName: role.faction?.zone?.name });
  if (playtestLocked) {
    return { error: "That role is closed for this playtest." };
  }
  const leaderWhitelisted =
    bypass || config?.leaderWhitelistEnabled === false || isLeaderWhitelisted(member);
  if (role.grantsLeader && !leaderWhitelisted) {
    return { error: "That role isn't available to you." };
  }
  const cursed = isCursed(member);
  if (!isRoleSelectable({ role, cursed, leaderWhitelisted })) {
    return { error: `While cursed you may only return as ${CURSED_ROLE_SLUGS.join(" or ")}.` };
  }

  const result = await reserveRole(prisma, discordUserId, roleId, config?.playerCount ?? 100);
  if (!result.ok) {
    return { error: `${role.name} was taken while you were deciding. Pick another role.` };
  }
  return { ok: true, expiresAt: result.expiresAt };
}
