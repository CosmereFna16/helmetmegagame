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

// Creates a character from the wizard's final Confirm step.
//
// Everything the client sent is re-derived and re-checked here. The wizard's
// own gating (full roles greyed out, Next disabled while overspent) is UX
// only — this action is the actual enforcement boundary, and it has to be,
// since a server action is a public HTTP endpoint that anyone can post to
// directly.
//
// The seat-cap recheck also closes a genuine race the UI cannot: two players
// sitting on the last Baron seat both see "0/1" and both hit Confirm. A bare
// count inside the transaction is NOT enough on its own — Prisma runs at
// READ COMMITTED, so two concurrent transactions can both read the same
// pre-insert count and both commit. The `FOR UPDATE` row lock on the Role
// below is what actually serializes the two attempts, same pattern as
// equipActions.js's equip-slot check. The wizard's own reservation
// (db/lib/roleReservation.js) only narrows the window before Confirm; this
// lock is what closes it.
export async function createCharacter(formData) {
  const session = await auth();
  if (!session?.discordUserId) redirect("/");
  const discordUserId = session.discordUserId;

  const part = (key, limit) => formData.get(key)?.toString().trim().slice(0, limit) || null;
  // `title` is deliberately absent: it is GM-granted, set only from
  // /gm/dev/characters/[characterId]. Not reading it here is the lock.
  //
  // The honorific is only READ here. Whether this character has earned it
  // depends on their role and their tags, neither of which is resolved yet —
  // so the gate runs further down, once both are known.
  const rawHonorific = formData.get("honorific");
  // Unlike the title, gender needs no deferred gate — it is a closed enum, so
  // the allowlist IS the boundary and junk lands as NEUTRAL. A locked seat
  // overwrites it once the role is known, below.
  const postedGender = formData.get("gender")?.toString();
  const gender = GENDERS.includes(postedGender) ? postedGender : "NEUTRAL";
  const firstName = part("firstName", NAME_LIMITS.firstName);
  // Not const: a Baroness/Heir/Successor wears the Baron's last name rather
  // than one they typed, so this is overwritten once the role is known below.
  let lastName = part("lastName", NAME_LIMITS.lastName);
  // Optional at creation — a player who skips it sets it later from
  // /character, where it locks on that first save instead.
  const rawAge = Number.parseInt(formData.get("age")?.toString() ?? "", 10);
  const age =
    Number.isInteger(rawAge) && rawAge >= AGE_MIN && rawAge <= AGE_MAX ? rawAge : null;
  const roleId = formData.get("roleId")?.toString();
  const tagIds = formData.getAll("tagIds").map((t) => t.toString()).filter(Boolean);
  // Consent data — which secretly assigned antagonist seats this player is open
  // to. The checkboxes are UX; the normalizer's allowlist is the boundary that
  // keeps junk slugs out of the column, same as normalizeHonorific above.
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
    // The zone comes along for the playtest lock below — it matches the
    // Windlands by zone, since no column marks a role as a Windlander one.
    prisma.role.findUnique({
      where: { id: roleId },
      include: { faction: { include: { zone: true } }, startingZone: true },
    }),
    prisma.gameConfig.findUnique({ where: { id: 1 } }),
    getGuildMember(discordUserId),
    prisma.turn.findFirst({ where: { status: "OPEN" }, select: { number: true } }),
  ]);
  if (!role) return { error: "That role no longer exists." };

  // The launch gate, checked before any of the point-buy work below so a
  // closed game costs nothing to bounce. Both halves have to hold: the game
  // has to be open, and this member has to be on the list. This is the real
  // enforcement boundary — the wizard hides itself too, but a server action
  // is a public endpoint, so the check that matters is this one.
  //
  // A superadmin walks through both halves. This is host/developer access
  // (one hardcoded Discord ID, see web/lib/superadmin.js), not a game
  // permission — it exists so the host can roll a test character before the
  // doors open, which is otherwise impossible without flipping the live
  // openToPlayers toggle for everyone.
  const bypass = isSuperadmin(discordUserId);
  if (!bypass && !config?.openToPlayers) {
    return { error: "Ravenheart isn't open yet. Character creation opens when the game begins." };
  }
  if (!bypass && !isApprovedPlayer(member)) {
    return { error: "You aren't on the roster for this game. Ask a GM if you think that's wrong." };
  }

  // Held back for a playtest from /gm/dev. Deliberately outside the `bypass`
  // above: the host is locked out too, because the point is that the role
  // isn't finished, not that it's reserved (see characterCreation.js).
  const playtestLocked =
    config?.playtestModeEnabled === true &&
    isPlaytestLocked({ role, zoneName: role.faction?.zone?.name });
  if (playtestLocked) {
    return { error: "That role is closed for this playtest." };
  }

  // Split from the isRoleSelectable call below so each rejection gets its own
  // message — the shared predicate can only say "no", not why.
  // A GM can turn the whitelist requirement off game-wide from /gm/dev.
  // `=== false` rather than a falsy check: no config row leaves it enforced.
  const leaderWhitelisted =
    bypass || config?.leaderWhitelistEnabled === false || isLeaderWhitelisted(member);
  if (role.grantsLeader && !leaderWhitelisted) {
    return { error: "That role isn't available to you." };
  }

  const cursed = isCursed(member);
  if (!isRoleSelectable({ role, cursed, leaderWhitelisted })) {
    return { error: `While cursed you may only return as ${CURSED_ROLE_SLUGS.join(" or ")}.` };
  }

  // The Baroness, Heir and Successor are the Baron's family: their last name
  // is his, never one they typed. The wizard greys the input out once such a
  // role is picked, but the input is only the hint — not reading what it
  // posted is the lock, same as `title` above. Null when no Baron is alive
  // yet, which is the common case at creation; he propagates his name to them
  // the moment he rolls up (see below).
  if (isDynastyMember(role.slug)) lastName = await dynastyLastName();

  // The same four seats fix the holder's gender as hand down the surname, and
  // for the same reason: the Baron is a man and the Successor is his daughter.
  // The wizard greys the picker out once such a role is picked, but the greying
  // is only the hint — taking the seat's value over the posted one is the lock.
  const effectiveGender = role.lockedGender ?? gender;

  // Selected tags must actually be buyable — a hand-posted request could
  // otherwise name a 0-cost, non-purchasable tag like Nobility.
  const selected = tagIds.length
    ? await prisma.tag.findMany({
        where: { id: { in: tagIds }, purchasable: true },
        // The group's requiredTagId is the hidden-category gate that
        // requirementSatisfied() checks below — without it a hand-posted
        // request could buy straight into the Demoness category.
        include: { group: { select: { requiredTagId: true } } },
      })
    : [];
  if (selected.length !== tagIds.length) {
    return { error: "One of those tags isn't available for purchase." };
  }

  // Role tags come from the catalog by name (roles.yaml authors them as
  // display names, and db:sync-roles has already validated every one).
  const startingTags = role.startingTagSlugs.length
    ? await prisma.tag.findMany({ where: { name: { in: role.startingTagSlugs } } })
    : [];

  // Now both halves of "what did they earn" exist, so the title can be gated.
  // A word this character has no claim to lands as null rather than failing
  // the create: the wizard already filtered the dropdown, so anything else
  // arriving here is a hand-posted request, and silently going untitled is
  // the right answer to one.
  const honorific = normalizeEarnedHonorific(rawHonorific, {
    tagSlugs: [...selected, ...startingTags].map((t) => t.slug),
    roleSlug: role.slug,
    gender: effectiveGender,
  });
  const name = formatCharacterName({ honorific, firstName, title: null, lastName });

  // The full catalog, not just what's selected/granted, so a chain walk
  // (parentTagId) never dead-ends on an ancestor the client didn't send.
  const allTags = await prisma.tag.findMany({
    // `name` and `exclusive` ride along for the exclusivity check below —
    // exclusiveConflict() reads both off the conflicting row. conflictsWith
    // is what conflictingTag() reads for the same check.
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

  // A hand-posted request could submit two tiers of the same chain at once
  // (the UI never lets that happen — selecting one auto-drops the other),
  // or buy in below a tier the role already grants (a chain replaces upward,
  // it never re-opens downward).
  for (const tag of selected) {
    if (chainSiblingsToRemove(tag, byId, tagIds).length > 0) {
      return { error: "You can only hold one tier of the same skill chain." };
    }
    if (heldHigherTiers(tag, byId, grantedIds).length > 0) {
      return { error: "Your role already grants a higher tier of that skill chain." };
    }
  }

  // Prerequisites: requiredTag — and the group gate behind a hidden category
  // — must be satisfied by something granted or selected alongside it (any
  // tier of that tag's own chain counts).
  const heldOrSelectedIds = [...grantedIds, ...tagIds];
  for (const tag of selected) {
    if (!requirementSatisfied(tag, byId, heldOrSelectedIds)) {
      return { error: "One of those tags is missing a prerequisite." };
    }
  }

  // One exclusive tag per character (the Beliefs). Checked against the role's
  // starting tags too, not just the cart: several roles grant a belief for
  // free, and picking a second one on top is exactly what this rules out.
  // `selected` carries the full row, so tag.exclusive is present here.
  for (const tag of selected) {
    const conflict = exclusiveConflict(tag, heldOrSelectedIds, byId);
    if (conflict) {
      return { error: `${tag.name} and ${conflict.name} can't be held at the same time.` };
    }
  }

  // Named conflict pairs (Tag.conflictsWith — Sober vs. every Addiction).
  // `selected` doesn't select the conflictsWith relation, so this reads the
  // full catalog row (`byId`, which conflictingTag() also needs for the
  // return value) rather than the bare `tag`.
  for (const tag of selected) {
    const catalogTag = byId.get(tag.id) ?? tag;
    const conflict = conflictingTag(catalogTag, heldOrSelectedIds, byId);
    if (conflict) {
      return { error: `${tag.name} conflicts with ${conflict.name}.` };
    }
  }

  // The drawback cap (TAGS.md §4a): a COUNT of drawback tags. Only what's
  // bought here counts: the role's own starting tags are granted below as
  // GM_GRANT and never pass through `selected`, so the Meister's free Frail
  // costs nobody a slot of the cap.
  const maxDrawbacks = config?.maxDrawbackTags ?? DEFAULT_MAX_DRAWBACK_TAGS;
  const drawbackCount = negativeTagCount(selected);
  if (drawbackCount > maxDrawbacks) {
    return {
      error: `You picked ${drawbackCount} drawbacks and can take at most ${maxDrawbacks}.`,
    };
  }

  const budget = computeBudget({ startingTagPoints: config?.startingTagPoints ?? 0, role, cursed });
  // Discounted by what the role already grants, matching what every row and
  // the build pane showed the player.
  const spent = effectiveTotalCost(selected, byId, grantedIds);
  if (spent > budget) {
    return { error: `That costs ${spent} points and you have ${budget}.` };
  }

  // Deduplicate: a player can pay for a tag the role also grants only if the
  // menu let them, but a direct post could. Union them, and refund nothing —
  // the budget check above already passed.
  //
  // A tag with a catalog duration has to arrive already stamped, or it sits
  // on the sheet forever: resolveNeeds()' sweep only ever looks at
  // expiresTurn, and nothing else backfills it. This is what makes a timed
  // starting pick (a Tipsy, a Wound) actually run out. Both tag sets are
  // fetched without a `select`, so defaultDurationTurns is already on them.
  // Before the game opens there is no turn to count from, so nothing
  // expires.
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
    // chain — the plain union would seat both rungs on the new sheet. The
    // discount already happened above (effectiveTotalCost over grantedIds),
    // so the player paid exactly the difference for exactly one rung.
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
      // Release the caller's own hold in the same transaction — it's spent
      // now, either way this commits.
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

  // Discord side effects, best-effort and strictly ordered: narrowcast access
  // reads the zone/tags written above.
  //
  // Channel access is the zone's own "Zone: {Name}" role, granted here the
  // same way travel swaps it (web/lib/discordGuild.js#syncCharacterZoneRole).
  // It has nothing to do with the character's PERSONAL role, which is a
  // mentionable name token only — so a failed ensureCharacterRole above must
  // never cost a new character the rooms they can see.
  await ensureCharacterRole(created).catch(() => {});
  if (created.zoneId) {
    await syncCharacterZoneRole(discordUserId, null, created.zoneId).catch(() => {});
  }
  await syncCharacterNickname(discordUserId, formatBareName({ firstName, lastName })).catch(() => {});
  await syncCharacterNarrowcastAccess(created.id).catch(() => {});
  if (cursed) await removeCursedRole(discordUserId).catch(() => {});

  // A new Baron names the dynasty, so any family member already in play takes
  // his last name — including one created back when no Baron existed and so
  // carrying none. Best-effort: it renames other people's characters, and
  // failing it must not cost this player the character they just made.
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

// Called from the wizard on Next out of the Role step, and again on every
// later Next, so the hold's expiry keeps sliding out while the player is
// still working the form. A server action is a public endpoint, so this
// re-checks the same gates createCharacter does before touching the seat —
// the wizard already disables ineligible cards, but that's the hint, not
// the lock.
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
