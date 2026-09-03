import { prisma } from "@lifeweb/db";

// The tag catalog exactly as PointBuy consumes it, shared by the creation
// wizard's loader and /store so the two menus can never disagree about a
// tag's shape. The group's requiredTagId is the hidden-category gate
// (docs/systemdocs/TAGS.md §3) — drop it and every gated category silently
// opens for everyone. `extraTagIds` widens the query beyond purchasable tags
// (the store passes the buyer's held ids, so an unpurchasable held tag still
// reaches the client's byId map). `includeRoleStartingTags` does the same for
// role-locked starting tags the creation wizard needs to display.
export async function loadPointBuyCatalog(extraTagIds = [], { includeRoleStartingTags = false } = {}) {
  const or = [{ purchasable: true }];
  if (extraTagIds.length) or.push({ id: { in: extraTagIds } });
  if (includeRoleStartingTags) {
    // Despite the column name, startingTagSlugs holds tag NAMES (roles.yaml
    // `starting_tags: [Pale]`, matched by name in sync-roles and PointBuy).
    const roles = await prisma.role.findMany({ select: { startingTagSlugs: true } });
    const names = [...new Set(roles.flatMap((r) => r.startingTagSlugs))];
    if (names.length) or.push({ name: { in: names } });
  }
  const tags = await prisma.tag.findMany({
    where: or.length === 1 ? or[0] : { OR: or },
    include: {
      group: {
        select: {
          slug: true,
          name: true,
          color: true,
          requiredTagId: true,
          // The gate's NAME, for the "Requires: …" line on rows and chips.
          // Safe to ship: gated tags only ever render for viewers who hold
          // the gate (unlockedTags / getVisibleTags filter the rest out).
          requiredTag: { select: { name: true } },
        },
      },
      requiredTag: { select: { name: true } },
      requirementSkills: { select: { id: true, slug: true, name: true } },
      // conflictingTag() reads conflictsWithIds off this projection — drop it
      // and a conflict silently stops applying in the menu.
      conflictsWith: { select: { id: true } },
    },
  });
  return tags.map((t) => ({
    id: t.id,
    // The stable identifier. The creation wizard needs it to work out which
    // titles a build has earned (db/lib/titles.js keys on slugs), since
    // roles.yaml `starting_tags` carries display names rather than slugs.
    slug: t.slug,
    name: t.name,
    description: t.description,
    category: t.category,
    pointCost: t.pointCost,
    purchasable: t.purchasable,
    purchasableAfterStart: t.purchasableAfterStart,
    // roleExcluded() reads this off the projection — drop it and Devoted
    // Follower reappears in a Migrant's menu.
    excludedRoleSlugs: t.excludedRoleSlugs,
    parentTagId: t.parentTagId,
    requiredTagId: t.requiredTagId,
    requiredTag: t.requiredTag,
    // At most one of these per character (the Beliefs). PointBuy's byId map is
    // built from this projection, so exclusiveConflict() reads the flag off it
    // — drop the field and the rule silently stops applying in the menu.
    exclusive: t.exclusive,
    // exclusiveConflict() scopes the rule to the group (one Belief, one
    // Addiction): without the id every exclusive tag looks like one group.
    groupId: t.groupId,
    group: t.group,
    // conflictingTag() scope: the plain id array conflictsWith resolves to.
    conflictsWithIds: t.conflictsWith.map((c) => c.id),
    removable: t.removable,
    craftable: t.craftable,
    requirementTurns: t.requirementTurns,
    requirementResources: t.requirementResources,
    requirementGambit: t.requirementGambit,
    requirementSkills: t.requirementSkills,
    // Health tags carry a course as well as a price: how long the affliction
    // runs untreated, and what it turns into afterwards. Both belong in the
    // point-buy chip — a player picking up Appendicitis as a drawback should
    // see where it ends before they take the points for it.
    defaultDurationTurns: t.defaultDurationTurns,
    expiresInto: t.expiresInto,
  }));
}
