import { redirect } from "next/navigation";
import Link from "next/link";
import { prisma } from "@lifeweb/db";
import { auth } from "@/lib/auth";
import { isSuperadmin } from "@/lib/superadmin";
import { updateZone } from "../actions";

export default async function DevZonesPage() {
  const session = await auth();
  if (!session?.discordUserId) redirect("/");
  if (!isSuperadmin(session.discordUserId)) redirect("/character");

  const zones = await prisma.zone.findMany({ orderBy: { name: "asc" } });

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6 p-6 sm:p-8">
      <Link href="/gm/dev" className="btn-quiet">&larr; Back to Dev Panel</Link>
      <h1 className="text-2xl font-bold">Zones ({zones.length})</h1>

      <div className="panel overflow-x-auto">
        <table className="data-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Discord channel IDs (comma-separated)</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {zones.map((z) => (
              <tr key={z.id}>
                <td>
                  <form action={updateZone} id={`zone-${z.id}`} className="contents">
                    <input type="hidden" name="zoneId" value={z.id} />
                  </form>
                  <input name="name" defaultValue={z.name} form={`zone-${z.id}`} className="text-input" />
                </td>
                <td>
                  <input
                    name="discordChannelIds"
                    defaultValue={z.discordChannelIds.join(", ")}
                    form={`zone-${z.id}`}
                    className="text-input"
                    style={{ width: "100%" }}
                  />
                </td>
                <td>
                  <button type="submit" form={`zone-${z.id}`} className="btn-quiet">
                    Save
                  </button>
                </td>
              </tr>
            ))}
            {zones.length === 0 && (
              <tr>
                <td colSpan={3} className="text-center" style={{ color: "var(--muted)" }}>
                  No zones yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
