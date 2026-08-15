import { redirect } from "next/navigation";
import { prisma } from "@lifeweb/db";
import { getGmSession } from "@/lib/discordGuild";
import { refreshArchiveStars } from "../gm/actions";

const PAGE_SIZE = 50;

export default async function ArchivePage({ searchParams }) {
  const { session, isGm: gm } = await getGmSession();
  if (!session?.discordUserId) redirect("/");

  const params = await searchParams;
  const zoneId = params?.zone?.toString().trim() || "";
  const character = params?.character?.toString().trim() || "";
  const sort = params?.sort?.toString() === "stars" ? "stars" : "date";
  const page = Math.max(1, Number.parseInt(params?.page?.toString() ?? "1", 10) || 1);

  // Players only ever see messages they personally starred — matching what a
  // player could actually see on the map (zones, private threads used for
  // secret conversations, etc.) isn't tracked by the archive, so "your own
  // stars" is the safe scope instead.
  const where = {
    ...(gm && zoneId ? { zoneId } : {}),
    ...(gm && character ? { characterName: { contains: character, mode: "insensitive" } } : {}),
    ...(!gm ? { stars: { some: { discordUserId: session.discordUserId } } } : {}),
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
    gm ? prisma.zone.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }) : Promise.resolve([]),
  ]);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  function pageHref(newPage) {
    const next = new URLSearchParams({ zone: zoneId, character, sort, page: String(newPage) });
    for (const key of [...next.keys()]) {
      if (!next.get(key)) next.delete(key);
    }
    return `/archive?${next.toString()}`;
  }

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6 p-6 sm:p-8">
      <h1 className="text-2xl font-bold">Archive</h1>
      <p className="text-sm" style={{ color: "var(--muted)" }}>
        {gm
          ? "Messages starred with ⭐ in tupper channels land here."
          : "Messages you've starred with ⭐ in tupper channels land here."}
      </p>

      <form className="panel flex flex-wrap items-end gap-3 p-4">
        {gm && (
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
        )}
        {gm && (
          <label className="field">
            <span className="field-label">Character</span>
            <input name="character" defaultValue={character} placeholder="Search by name..." />
          </label>
        )}
        <label className="field">
          <span className="field-label">Sort by</span>
          <select name="sort" defaultValue={sort}>
            <option value="date">Newest first</option>
            <option value="stars">Most stars</option>
          </select>
        </label>
        <button type="submit" className="btn">
          {gm ? "Filter" : "Sort"}
        </button>
      </form>

      {gm ? (
        <form action={refreshArchiveStars} className="flex flex-col gap-3">
          {entries.map((e) => (
            <input key={e.id} type="hidden" name="id" value={e.id} />
          ))}
          <button type="submit" className="btn-quiet self-start" disabled={entries.length === 0}>
            Refresh star counts
          </button>
          <ArchiveTable entries={entries} showZone />
        </form>
      ) : (
        <ArchiveTable entries={entries} showZone={false} />
      )}

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

function ArchiveTable({ entries, showZone }) {
  return (
    <div className="panel overflow-x-auto">
      <table className="data-table">
        <thead>
          <tr>
            <th>Character</th>
            {showZone && <th>Zone</th>}
            <th>Stars</th>
            <th>Sent</th>
            <th>Message</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => (
            <tr key={entry.id}>
              <td className="whitespace-nowrap">{entry.characterName}</td>
              {showZone && <td className="whitespace-nowrap">{entry.zone?.name ?? "-"}</td>}
              <td>⭐ {entry.starCount}</td>
              <td className="whitespace-nowrap">{entry.sentAt.toISOString()}</td>
              <td className="max-w-md">{entry.content}</td>
            </tr>
          ))}
          {entries.length === 0 && (
            <tr>
              <td colSpan={showZone ? 5 : 4} className="text-center" style={{ color: "var(--muted)" }}>
                No starred messages match these filters.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
