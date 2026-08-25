import { prisma } from "@lifeweb/db";

// The tag catalog exactly as PointBuy consumes it, shared by the creation
// wizard's loader and /store so the two menus can never disagree about a
// tag's shape. The projection is deliberately generous: chips show duration
// and expiry, rows show requirement blocks, and the group's requiredTagId is
// the hidden-category gate (docs/systemdocs/TAGS.md §3) — drop it and every
// gated category silently opens for everyone.
//
// `extraTagIds` widens the query beyond purchasable tags. The store passes
// the buyer's held tag ids: a held but unpurchasable tag (a GM-granted
// Demoness, a crafted item) still has to reach the client's byId map, or the
// chain walks and group gates that key off it silently stop resolving —
// which would hide the Demoness category from the one player it exists for.
export async function loadPointBuyCatalog(extraTagIds = []) {
  const tags = await prisma.tag.findMany({
    where: extraTagIds.length
      ? { OR: [{ purchasable: true }, { id: { in: extraTagIds } }] }
      : { purchasable: true },
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
    },
  });
  return tags.map((t) => ({
    id: t.id,
    name: t.name,
    description: t.description,
    category: t.category,
    pointCost: t.pointCost,
    purchasable: t.purchasable,
    purchasableAfterStart: t.purchasableAfterStart,
    parentTagId: t.parentTagId,
    requiredTagId: t.requiredTagId,
    requiredTag: t.requiredTag,
    group: t.group,
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
