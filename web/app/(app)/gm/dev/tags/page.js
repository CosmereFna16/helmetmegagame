import { redirect } from "next/navigation";
import { prisma } from "@lifeweb/db";
import { getGmSession } from "@/lib/discordGuild";
import { isSuperadmin } from "@/lib/superadmin";
import PageShell, { PageHeader } from "@/app/components/PageShell";
import DevSubNav from "../DevSubNav";
import TagCatalog from "./TagCatalog";

// The tag catalog, with a Create dialog for GM-authored tags.
//
// YAML-sourced rows are read-only here on purpose: docs/tags.yaml is their
// source of truth and syncTags would revert a UI edit on its next run. Only
// rows carrying Tag.custom are editable, and only a superadmin may delete one.
export default async function DevTagsPage() {
  const { session, isGm: gm } = await getGmSession();
  if (!session?.discordUserId) redirect("/");
  if (!gm) redirect("/character");

  const [tags, groups, counts] = await Promise.all([
    prisma.tag.findMany({
      orderBy: [{ category: "asc" }, { name: "asc" }],
      include: {
        group: { select: { id: true, name: true, color: true } },
        requirementSkills: { select: { name: true } },
      },
    }),
    prisma.tagGroup.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, category: true } }),
    prisma.characterTag.groupBy({ by: ["tagId"], _count: { tagId: true } }),
  ]);

  const heldCount = new Map(counts.map((c) => [c.tagId, c._count.tagId]));

  return (
    <PageShell width="wide">
      <PageHeader
        title="Tag Catalog"
        subtitle="Everything in the catalog, plus the tags GMs have written themselves."
        actions={<DevSubNav current="tags" />}
      />

      <TagCatalog
        tags={tags.map((t) => ({
          id: t.id,
          name: t.name,
          slug: t.slug,
          category: t.category,
          description: t.description,
          pointCost: t.pointCost,
          custom: t.custom,
          groupId: t.groupId,
          groupName: t.group?.name ?? null,
          inspectVisibility: t.inspectVisibility,
          stackable: t.stackable,
          equippable: t.equippable,
          consumable: t.consumable,
          removable: t.removable,
          tradeable: t.tradeable,
          craftable: t.craftable,
          purchasable: t.purchasable,
          purchasableAfterStart: t.purchasableAfterStart,
          defaultDurationTurns: t.defaultDurationTurns,
          sellable: t.sellable,
          sellablePrice: t.sellablePrice,
          // Everything below feeds the read-only detail sheet: the tier chain
          // and prerequisite links (walked client-side over this same list),
          // the consume/expiry targets, and the requirement block.
          groupColor: t.group?.color ?? null,
          parentTagId: t.parentTagId,
          requiredTagId: t.requiredTagId,
          consumesInto: t.consumesInto,
          expiresInto: t.expiresInto,
          requirementTurns: t.requirementTurns,
          requirementResources: t.requirementResources,
          requirementGambit: t.requirementGambit,
          requirementSkills: t.requirementSkills,
          held: heldCount.get(t.id) ?? 0,
        }))}
        groups={groups}
        categories={[...new Set(tags.map((t) => t.category))].sort((a, b) => a.localeCompare(b))}
        canDelete={isSuperadmin(session.discordUserId)}
      />
    </PageShell>
  );
}
