import { redirect } from "next/navigation";
import { prisma } from "@lifeweb/db";
import { getGmSession } from "@/lib/discordGuild";
import { refreshArchiveStars } from "../actions";

const PAGE_SIZE = 50;

export default async function ArchivePage({ searchParams }) {
  const { session, isGm: gm } = await getGmSession();
  if (!session?.discordUserId) redirect("/");
  if (!gm) redirect("/character");

  const params = await searchParams;
  const zoneId = params?.zone?.toString().trim() || "";
  const character = params?.character?.toString().trim() || "";
  const sort = params?.sort?.toString() === "stars" ? "stars" : "date";
  const page = Math.max(1, Number.parseInt(params?.page?.toString() ?? "1", 10) || 1);

  const where = {
    ...(zoneId ? { zoneId } : {}),
    ...(character ? { characterName: { contains: character, mode: "insensitive" } } : {}),
  };
  const orderBy = sort === "stars" ? [{ starCount: "desc" }, { sentAt: "desc" }] : [{ sentAt: "desc" }];

  const [entries, total, zones] = await Promise.all([
    prisma.archivedMessage.findMany({
      where,
      orderBy,
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: { zone: { select: { name: true } } },
    }),
    prisma.archivedMessage.count({ where }),
    prisma.zone.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  function pageHref(newPage) {
    const next = new URLSearchParams({ zone: zoneId, character, sort, page: String(newPage) });
    for (const key of [...next.keys()]) {
      if (!next.get(key)) next.delete(key);
    }
    return `/gm/archive?${next.toString()}`;
  }

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6 p-6 sm:p-8">
      <h1 className="text-2xl font-bold">Archive</h1>
      <p className="text-sm" style={{ color: "var(--muted)" }}>
        Messages starred with ⭐ in tupper channels land here.
      </p>

      <form className="panel flex flex-wrap items-end gap-3 p-4">
        <label className="field">
          <span className="field-label">Zone</span>
          <select name="zone" defaultValue={zoneId}>
            <option value="">All zones</option>
            {zones.map((z) => (
              <option key={z.id} value={z.id}>
                {z.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field-label">Character</span>
          <input name="character" defaultValue={character} placeholder="Search by name..." />
        </label>
        <label className="field">
          <span className="field-label">Sort by</span>
          <select name="sort" defaultValue={sort}>
            <option value="date">Newest first</option>
            <option value="stars">Most stars</option>
          </select>
        </label>
        <button type="submit" className="btn">
          Filter
        </button>
      </form>

      <form action={refreshArchiveStars} className="flex flex-col gap-3">
        {entries.map((e) => (
          <input key={e.id} type="hidden" name="id" value={e.id} />
        ))}
        <button type="submit" className="btn-quiet self-start" disabled={entries.length === 0}>
          Refresh star counts
        </button>

        <div className="panel overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>Character</th>
                <th>Zone</th>
                <th>Stars</th>
                <th>Sent</th>
                <th>Message</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.id}>
                  <td className="whitespace-nowrap">{entry.characterName}</td>
                  <td className="whitespace-nowrap">{entry.zone?.name ?? "-"}</td>
                  <td>⭐ {entry.starCount}</td>
                  <td className="whitespace-nowrap">{entry.sentAt.toISOString()}</td>
                  <td className="max-w-md">{entry.content}</td>
                </tr>
              ))}
              {entries.length === 0 && (
                <tr>
                  <td colSpan={5} className="text-center" style={{ color: "var(--muted)" }}>
                    No starred messages match these filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </form>

      <div className="flex items-center justify-between text-sm" style={{ color: "var(--muted)" }}>
        <span>
          Page {page} of {totalPages} ({total} entries)
        </span>
        <div className="flex gap-3">
          {page > 1 && (
            <a href={pageHref(page - 1)} className="menu-item">
              Previous
            </a>
          )}
          {page < totalPages && (
            <a href={pageHref(page + 1)} className="menu-item">
              Next
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
