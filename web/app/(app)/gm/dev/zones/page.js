import { redirect } from "next/navigation";
import Link from "next/link";
import { prisma } from "@lifeweb/db";
import { auth } from "@/lib/auth";
import { isSuperadmin } from "@/lib/superadmin";
import { updateZone, updateLocation, createLocation, provisionLocationChannels } from "../actions";

export default async function DevZonesPage() {
  const session = await auth();
  if (!session?.discordUserId) redirect("/");
  if (!isSuperadmin(session.discordUserId)) redirect("/character");

  const zones = await prisma.zone.findMany({
    orderBy: { name: "asc" },
    include: { locations: { orderBy: { name: "asc" } } },
  });

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6 p-6 sm:p-8">
      <Link href="/gm/dev" className="btn-quiet">&larr; Back to Dev Panel</Link>
      <h1 className="text-2xl font-bold">Zones ({zones.length})</h1>

      {zones.map((z) => (
        <div key={z.id} className="panel flex flex-col gap-4 p-4">
          <div className="flex items-center gap-3">
            <form action={updateZone} id={`zone-${z.id}`} className="contents">
              <input type="hidden" name="zoneId" value={z.id} />
            </form>
            <input name="name" defaultValue={z.name} form={`zone-${z.id}`} className="text-input" style={{ maxWidth: 240 }} />
            <button type="submit" form={`zone-${z.id}`} className="btn-quiet">Save</button>
            <span style={{ color: "var(--muted)" }} className="text-sm">
              legacy discordChannelIds: {z.discordChannelIds.join(", ") || "(none)"}
            </span>
          </div>

          <table className="data-table">
            <thead>
              <tr>
                <th>Location</th>
                <th>Discord</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {z.locations.map((loc) => (
                <tr key={loc.id}>
                  <td>
                    <form action={updateLocation} id={`loc-${loc.id}`} className="contents">
                      <input type="hidden" name="locationId" value={loc.id} />
                    </form>
                    <input name="name" defaultValue={loc.name} form={`loc-${loc.id}`} className="text-input" />
                  </td>
                  <td style={{ color: "var(--muted)" }} className="text-sm">
                    {loc.discordCategoryId ? `category ${loc.discordCategoryId}` : "not provisioned"}
                  </td>
                  <td className="flex gap-2">
                    <button type="submit" form={`loc-${loc.id}`} className="btn-quiet">Save</button>
                    {loc.discordCategoryId ? (
                      <span style={{ color: "var(--muted)" }} className="text-sm">Provisioned</span>
                    ) : (
                      <form action={provisionLocationChannels.bind(null, loc.id)}>
                        <button type="submit" className="btn-quiet">Provision Discord channels</button>
                      </form>
                    )}
                  </td>
                </tr>
              ))}
              {z.locations.length === 0 && (
                <tr>
                  <td colSpan={3} className="text-center" style={{ color: "var(--muted)" }}>
                    No locations yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>

          <form action={createLocation} className="flex gap-2">
            <input type="hidden" name="zoneId" value={z.id} />
            <input name="name" placeholder="New location name" className="text-input" style={{ flex: 1 }} />
            <button type="submit" className="btn-quiet">Add location</button>
          </form>
        </div>
      ))}

      {zones.length === 0 && (
        <div className="panel p-4 text-center" style={{ color: "var(--muted)" }}>
          No zones yet. Run <code>npm run db:seed-zones</code>.
        </div>
      )}
    </div>
  );
}
