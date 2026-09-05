import { redirect } from "next/navigation";
import { prisma } from "@lifeweb/db";
import { getGmSession } from "@/lib/discordGuild";
import { statusWord } from "@lifeweb/db/lib/structures";
import PageShell, { PageHeader } from "@/app/components/PageShell";
import StructuresTable from "./StructuresTable";

// Every structure in the world, with the GM's Damage/Repair/Destroy/Clear
// verbs (docs/systemdocs/ADJUDICATION.md carries the conventions — the
// player half is a Gambit at the desk; this is where its outcome lands).
// Open to every GM, not just the superadmin: rulings happen here, and a
// tool four of five GMs can't reach is a rule only one of them remembers.
// No rail item — reachable through ⌘K, like the rest of the GM pages
// without one.
export default async function StructuresPage() {
  const { session, isGm } = await getGmSession();
  if (!session?.discordUserId) redirect("/");
  if (!isGm) redirect("/character");

  const rows = await prisma.structure.findMany({
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    include: {
      location: { select: { name: true, zone: { select: { name: true, sortOrder: true } } } },
      link: { select: { a: { select: { name: true } }, b: { select: { name: true } }, isOpen: true } },
    },
  });

  // Crew size per site, one groupBy for the page rather than one count per
  // row — the contributor list itself lives on the desk's request card.
  const work = rows.length
    ? await prisma.structureWork.groupBy({
        by: ["structureId"],
        _count: { _all: true },
        where: { structureId: { in: rows.map((r) => r.id) } },
      })
    : [];
  const crewBySite = new Map(work.map((w) => [w.structureId, w._count._all]));

  // DTOs only — the Prisma rows carry Dates and payer keys the client table
  // has no business holding.
  const structures = rows.map((row) => ({
    id: row.id,
    zoneName: row.location?.zone?.name ?? "—",
    locationName: row.location?.name ?? "—",
    typeName: row.typeName,
    status: row.status,
    statusLabel: statusWord(row.status),
    turnsDone: row.turnsDone,
    turnsNeeded: row.turnsNeeded,
    builderName: row.builderName ?? "—",
    payerName: row.payerName ?? "—",
    resourcesCost: row.resourcesCost ?? 0,
    crew: crewBySite.get(row.id) ?? 0,
    // The bound edge by its endpoint NAMES — a cuid means nothing at a desk.
    edgeLabel: row.link ? `${row.link.a.name} ↔ ${row.link.b.name}` : null,
    edgeOpen: row.link?.isOpen ?? null,
    createdAtMs: row.createdAt.getTime(),
  }));

  return (
    <PageShell>
      <PageHeader
        title="Structures"
        subtitle="Everything built, rising or wrecked, and the rulings on it. Damage stops a structure serving — its bonus, its kit — until Repair; Destroy makes a ruin and reverts any edge it held; Clear sweeps a wreck off the map. ‡"
      />
      <StructuresTable structures={structures} />
    </PageShell>
  );
}
