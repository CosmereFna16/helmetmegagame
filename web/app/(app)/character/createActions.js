"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma, roleCapacity } from "@lifeweb/db";
import { auth } from "@/lib/auth";
import {
  syncCharacterNickname,
  ensureCharacterRole,
  syncCharacterLocationAccess,
  syncCharacterSpecialAccess,
} from "@/lib/discordGuild";
import {
  computeBudget,
  isRoleSelectable,
  totalCost,
  CURSED_ROLE_SLUGS,
} from "@/lib/characterCreation";

const NAME_MAX_LENGTH = 60;

// Creates a character from the wizard's final Confirm step.
//
// Everything the client sent is re-derived and re-checked here. The wizard's
// own gating (full roles greyed out, Next disabled while overspent) is UX
// only — this action is the actual enforcement boundary, and it has to be,
// since a server action is a public HTTP endpoint that anyone can post to
// directly.
//
// The seat-cap recheck also closes a genuine race the UI cannot: two players
// sitting on the last Baron seat both see "0/1" and both hit Confirm. The
// count is taken inside the transaction that creates the character, so the
// second one loses.
export async function createCharacter(formData) {
  const session = await auth();
  if (!session?.discordUserId) redirect("/");
  const discordUserId = session.discordUserId;

  const name = formData.get("name")?.toString().trim().slice(0, NAME_MAX_LENGTH);
  const preferredNickname = formData.get("preferredNickname")?.toString().trim() || null;
  const roleId = formData.get("roleId")?.toString();
  const tagIds = formData.getAll("tagIds").map((t) => t.toString()).filter(Boolean);

  if (!name) return { error: "Your character needs a name." };
  if (!roleId) return { error: "Pick a role before confirming." };

  if (await prisma.character.findFirst({ where: { discordUserId, status: "ALIVE" } })) {
    redirect("/character");
  }

  const [role, config, player] = await Promise.all([
    prisma.role.findUnique({ where: { id: roleId }, include: { faction: true, startingLocation: true } }),
    prisma.gameConfig.findUnique({ where: { id: 1 } }),
    prisma.player.findUnique({ where: { discordUserId } }),
  ]);
  if (!role) return { error: "That role no longer exists." };

  const cursed = player?.cursed ?? false;
  if (!isRoleSelectable({ role, cursed })) {
    return { error: `While cursed you may only return as ${CURSED_ROLE_SLUGS.join(" or ")}.` };
  }

  // Selected tags must actually be buyable — a hand-posted request could
  // otherwise name a 0-cost, non-purchasable tag like Nobility.
  const selected = tagIds.length
    ? await prisma.tag.findMany({ where: { id: { in: tagIds }, purchasable: true } })
    : [];
  if (selected.length !== tagIds.length) {
    return { error: "One of those tags isn't available for purchase." };
  }

  const budget = computeBudget({ startingTagPoints: config?.startingTagPoints ?? 0, role, cursed });
  const spent = totalCost(selected);
  if (spent > budget) {
    return { error: `That costs ${spent} points and you have ${budget}.` };
  }

  // Role tags come from the catalog by name (roles.yaml authors them as
  // display names, and db:sync-roles has already validated every one).
  const startingTags = role.startingTagSlugs.length
    ? await prisma.tag.findMany({ where: { name: { in: role.startingTagSlugs } } })
    : [];

  // Deduplicate: a player can pay for a tag the role also grants only if the
  // menu let them, but a direct post could. Union them, and refund nothing —
  // the budget check above already passed.
  const tagIdsToGrant = new Map();
  for (const tag of startingTags) tagIdsToGrant.set(tag.id, "GM_GRANT");
  for (const tag of selected) if (!tagIdsToGrant.has(tag.id)) tagIdsToGrant.set(tag.id, "POINT_BUY");

  let created;
  try {
    created = await prisma.$transaction(async (tx) => {
      const taken = await tx.character.count({ where: { roleId: role.id, status: "ALIVE" } });
      if (taken >= roleCapacity(role, config?.playerCount ?? 100)) {
        throw new Error("ROLE_FULL");
      }

      const character = await tx.character.create({
        data: {
          discordUserId,
          name,
          preferredNickname,
          roleId: role.id,
          roleTitle: role.name,
          factionId: role.factionId,
          locationId: role.startingLocationId,
          zoneId: role.startingLocation?.zoneId ?? null,
          resources: role.startingResources,
          tagPoints: budget - spent,
          isLeader: role.grantsLeader,
          isTreasurer: role.grantsTreasurer,
        },
      });

      await tx.characterTag.createMany({
        data: [...tagIdsToGrant].map(([tagId, source]) => ({ characterId: character.id, tagId, source })),
      });

      return character;
    });
  } catch (err) {
    if (err.message === "ROLE_FULL") {
      return { error: `${role.name} was taken while you were deciding. Pick another role.` };
    }
    throw err;
  }

  // Discord side effects, best-effort and strictly ordered: the personal role
  // must exist before it can be granted category access, and the special
  // channel gates read the tags written above.
  await ensureCharacterRole(created).catch(() => {});
  const withRole = await prisma.character.findUnique({ where: { id: created.id } });
  if (withRole?.discordRoleId && created.locationId) {
    await syncCharacterLocationAccess(withRole.discordRoleId, null, created.locationId).catch(() => {});
  }
  await syncCharacterNickname(discordUserId, name, preferredNickname).catch(() => {});
  await syncCharacterSpecialAccess(discordUserId, created.id).catch(() => {});

  await prisma.auditLog.create({
    data: {
      actorDiscordUserId: discordUserId,
      actionType: "character_created",
      targetCharacterId: created.id,
      details: {
        role: role.name,
        faction: role.faction?.name ?? null,
        location: role.startingLocation?.name ?? null,
        budget,
        spent,
        purchased: selected.map((t) => t.name),
      },
    },
  });

  revalidatePath("/", "layout");
  redirect("/character");
}
