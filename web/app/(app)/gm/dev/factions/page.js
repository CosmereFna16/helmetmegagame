import { redirect } from "next/navigation";
import Link from "next/link";
import { prisma } from "@lifeweb/db";
import { auth } from "@/lib/auth";
import { isSuperadmin } from "@/lib/superadmin";
import { updateFaction } from "../actions";

export default async function DevFactionsPage() {
  const session = await auth();
  if (!session?.discordUserId) redirect("/");
  if (!isSuperadmin(session.discordUserId)) redirect("/character");

  const factions = await prisma.faction.findMany({ orderBy: { name: "asc" } });

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6 p-6 sm:p-8">
      <Link href="/gm/dev" className="btn-quiet">&larr; Back to Dev Panel</Link>
      <h1 className="text-2xl font-bold">Factions ({factions.length})</h1>

      <div className="panel overflow-x-auto">
        <table className="data-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Discord role ID</th>
              <th>Silo</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {factions.map((f) => (
              <tr key={f.id}>
                <td>
                  <form action={updateFaction} id={`faction-${f.id}`} className="contents">
                    <input type="hidden" name="factionId" value={f.id} />
                  </form>
                  <input name="name" defaultValue={f.name} form={`faction-${f.id}`} className="text-input" />
                </td>
                <td>
                  <input
                    name="discordRoleId"
                    defaultValue={f.discordRoleId}
                    form={`faction-${f.id}`}
                    className="text-input"
                  />
                </td>
                <td>
                  <input
                    type="number"
                    name="silo"
                    defaultValue={f.silo}
                    form={`faction-${f.id}`}
                    className="text-input"
                    style={{ width: "6rem" }}
                  />
                </td>
                <td>
                  <button type="submit" form={`faction-${f.id}`} className="btn-quiet">
                    Save
                  </button>
                </td>
              </tr>
            ))}
            {factions.length === 0 && (
              <tr>
                <td colSpan={4} className="text-center" style={{ color: "var(--muted)" }}>
                  No factions yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
