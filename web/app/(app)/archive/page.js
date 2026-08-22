import { redirect } from "next/navigation";
import { prisma } from "@lifeweb/db";
import { auth } from "@/lib/auth";
import { getGmSession } from "@/lib/discordGuild";
import PageShell, { PageHeader } from "@/app/components/PageShell";
import Pager from "@/app/components/Pager";
import ArchiveFeed from "./ArchiveFeed";

const PAGE_SIZE = 100;

const KIND_OPTIONS = [
  ["MESSAGE", "Messages"],
  ["TURN_START", "Turns"],
  ["CHARACTER_CREATED", "Arrivals"],
  ["DEATH", "Deaths"],
  ["DESIRE_FULFILLED", "Desires"],
  ["WORST_FEAR_FULFILLED", "Worst Fears"],
  ["LIFEWEB", "Lifeweb"],
  ["TRAVEL", "Travel"],
];

export default async function ArchivePage({ searchParams }) {
  const session = await auth();
  if (!session?.discordUserId) redirect("/");

  // The real gate. The nav hides the link when it's shut, but a page is a
  // public URL — same posture as /character's creation gate, where the render
  // is presentation and the check is enforcement.
  const [{ isGm: gm }, config] = await Promise.all([
    getGmSession(),
    prisma.gameConfig.findUnique({ where: { id: 1 }, select: { archiveVisible: true } }),
  ]);
  if (!gm && !config?.archiveVisible) redirect("/character");

  const params = await searchParams;
  const kind = params?.kind?.toString().trim() || "";
  const locationId = params?.locationId?.toString().trim() || "";
  const characterId = params?.characterId?.toString().trim() || "";
  const day = params?.day?.toString().trim() || "";
  const q = params?.q?.toString().trim() || "";
  // Oldest-first by default: this is a diary to be read forward, not a log to
  // be skimmed newest-first like /gm/audit.
  const order = params?.order?.toString() === "desc" ? "desc" : "asc";
  const page = Math.max(1, Number.parseInt(params?.page?.toString() ?? "1", 10) || 1);

  // A day is two turns, Dawn first: day 3 is turns 5 and 6.
  const dayNumber = day ? Number.parseInt(day, 10) : null;
  const dayTurns =
    dayNumber && dayNumber > 0 ? [dayNumber * 2 - 1, dayNumber * 2] : null;

  const where = {
    ...(kind ? { kind } : {}),
    ...(locationId ? { locationId } : {}),
    ...(characterId ? { characterId } : {}),
    ...(dayTurns ? { turnNumber: { in: dayTurns } } : {}),
    ...(q ? { content: { contains: q, mode: "insensitive" } } : {}),
  };

  const [entries, total, locations, characters] = await Promise.all([
    prisma.archiveEntry.findMany({
      where,
      // id breaks ties: sentAt is only millisecond-resolution, and a burst of
      // proxied messages can share a timestamp — without it the same row can
      // appear on two pages and another on neither.
      orderBy: [{ sentAt: order }, { id: order }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    prisma.archiveEntry.count({ where }),
    prisma.location.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.character.findMany({
      select: { id: true, name: true },
      orderBy: [{ firstName: "asc" }, { lastName: { sort: "asc", nulls: "first" } }],
    }),
  ]);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // Cache-buster for the avatar route, which serves `immutable`. Only the
  // characters actually on this page, so a 100-row page is one small query
  // rather than a join against every row.
  const pageCharacterIds = [...new Set(entries.map((e) => e.characterId).filter(Boolean))];
  const avatarRows = pageCharacterIds.length
    ? await prisma.character.findMany({
        where: { id: { in: pageCharacterIds } },
        select: { id: true, updatedAt: true },
      })
    : [];
  const avatarVersions = Object.fromEntries(avatarRows.map((c) => [c.id, c.updatedAt.getTime()]));

  function pageHref(newPage) {
    const next = new URLSearchParams({ kind, locationId, characterId, day, q, order, page: String(newPage) });
    for (const key of [...next.keys()]) {
      if (!next.get(key)) next.delete(key);
    }
    return `/archive?${next.toString()}`;
  }

  return (
    <PageShell width="wide">
      <PageHeader
        title="Archive"
        subtitle={gm && !config?.archiveVisible ? "Hidden from players" : undefined}
      />

      <form className="panel flex flex-wrap items-end gap-3 p-4">
        <label className="field">
          <span className="field-label">Search</span>
          <input name="q" defaultValue={q} placeholder="anything said..." />
        </label>
        <label className="field">
          <span className="field-label">Day</span>
          <input name="day" type="number" min="1" defaultValue={day} placeholder="any" />
        </label>
        <label className="field">
          <span className="field-label">Location</span>
          <select name="locationId" defaultValue={locationId}>
            <option value="">Anywhere</option>
            {locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field-label">Character</span>
          <select name="characterId" defaultValue={characterId}>
            <option value="">Anyone</option>
            {characters.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field-label">Kind</span>
          <select name="kind" defaultValue={kind}>
            <option value="">Everything</option>
            {KIND_OPTIONS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field-label">Order</span>
          <select name="order" defaultValue={order}>
            <option value="asc">Oldest first</option>
            <option value="desc">Newest first</option>
          </select>
        </label>
        <button type="submit" className="btn">
          Apply
        </button>
      </form>

      <ArchiveFeed entries={entries} avatarVersions={avatarVersions} />

      <Pager
        page={page}
        totalPages={totalPages}
        total={total}
        unit="entries"
        prevHref={pageHref(page - 1)}
        nextHref={pageHref(page + 1)}
      />
    </PageShell>
  );
}
