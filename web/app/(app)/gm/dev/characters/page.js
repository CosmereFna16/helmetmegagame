import { redirect } from "next/navigation";
import Link from "next/link";
import { prisma } from "@lifeweb/db";
import { auth } from "@/lib/auth";
import { isSuperadmin } from "@/lib/superadmin";

export default async function DevCharactersPage() {
  const session = await auth();
  if (!session?.discordUserId) redirect("/");
  if (!isSuperadmin(session.discordUserId)) redirect("/character");

  const characters = await prisma.character.findMany({
    orderBy: { name: "asc" },
    include: { faction: true, zone: true },
    // Safety net against unbounded growth, not a real limit — far above any
    // realistic roster size for this game (100+ players).
    take: 1000,
  });

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6 p-6 sm:p-8">
      <Link href="/gm/dev" className="btn-quiet">&larr; Back to Dev Panel</Link>
      <h1 className="text-2xl font-bold">Characters ({characters.length})</h1>

      <div className="panel overflow-x-auto">
        <table className="data-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Faction</th>
              <th>Zone</th>
              <th>Status</th>
              <th>Resources ⬢</th>
              <th>Mood</th>
              <th>Hungry</th>
            </tr>
          </thead>
          <tbody>
            {characters.map((c) => (
              <tr key={c.id}>
                <td>
                  <Link href={`/gm/dev/characters/${c.id}`} className="menu-item">
                    {c.name}
                  </Link>
                </td>
                <td>{c.faction?.name ?? "-"}</td>
                <td>{c.zone?.name ?? "-"}</td>
                <td>{c.status}</td>
                <td>{c.resources}</td>
                <td>{c.moodState}</td>
                <td>{c.isHungry ? "Yes" : "No"}</td>
              </tr>
            ))}
            {characters.length === 0 && (
              <tr>
                <td colSpan={7} className="text-center" style={{ color: "var(--muted)" }}>
                  No characters yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
