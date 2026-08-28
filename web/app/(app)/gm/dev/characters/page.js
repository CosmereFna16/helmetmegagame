import { EmptyRow } from "@/app/components/EmptyState";
import { EnumPill, CHARACTER_STATUS } from "@/app/components/StatusPill";
import { redirect } from "next/navigation";
import Link from "next/link";
import { prisma } from "@lifeweb/db";
import { auth } from "@/lib/auth";
import { isSuperadmin } from "@/lib/superadmin";
import PageShell, { PageHeader } from "@/app/components/PageShell";
import FactionLink from "@/app/components/FactionLink";
import CharacterAvatar from "@/app/components/CharacterAvatar";

// Name, Faction, Zone, Status, Resources — kept beside the <thead> it counts.
const COL_COUNT = 5;

export default async function DevCharactersPage() {
  const session = await auth();
  if (!session?.discordUserId) redirect("/");
  if (!isSuperadmin(session.discordUserId)) redirect("/character");

  const characters = await prisma.character.findMany({
    orderBy: [{ firstName: "asc" }, { lastName: { sort: "asc", nulls: "first" } }],
    include: { faction: true, zone: true },
    // Safety net against unbounded growth, not a real limit — far above any
    // realistic roster size for this game (100+ players).
    take: 1000,
  });

  return (
    <PageShell>
      <Link href="/gm/dev" className="btn-quiet">&larr; Back to Dev Panel</Link>
      <PageHeader title={`Characters (${characters.length})`} />

      <div className="panel overflow-x-auto">
        <table className="data-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Faction</th>
              <th>Zone</th>
              <th>Status</th>
              <th>Resources</th>
            </tr>
          </thead>
          <tbody>
            {characters.map((c) => (
              <tr key={c.id}>
                <td>
                  <Link href={`/gm/dev/characters/${c.id}`} className="menu-item inline-flex items-center gap-2">
                    <CharacterAvatar characterId={c.id} name={c.name} version={c.updatedAt.getTime()} />
                    {c.name}
                  </Link>
                </td>
                <td>
                  <FactionLink factionId={c.factionId} name={c.faction?.name ?? "-"} />
                </td>
                <td>{c.zone?.name ?? "-"}</td>
                <td>
                  <EnumPill map={CHARACTER_STATUS} value={c.status} />
                </td>
                <td>{c.resources} ⬢</td>
              </tr>
            ))}
            {characters.length === 0 && (
              <EmptyRow cols={COL_COUNT}>No characters yet.</EmptyRow>
            )}
          </tbody>
        </table>
      </div>
    </PageShell>
  );
}
