import { redirect } from "next/navigation";
import { prisma } from "@lifeweb/db";
import { auth } from "@/lib/auth";
import { getGmSession } from "@/lib/discordGuild";
import PageShell, { PageHeader } from "@/app/components/PageShell";
import Pager from "@/app/components/Pager";
import Select from "@/app/components/Select";
import ArchiveFeed from "./ArchiveFeed";

const PAGE_SIZE = 100;

const KIND_OPTIONS = [
  ["MESSAGE", "Messages"],
  ["TURN_START", "Turns"],
  ["CHARACTER_CREATED", "Arrivals"],
  ["DEATH", "Deaths"],
  ["DESIRE_FULFILLED", "Desires"],
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
  // Validated against the option list above, not passed through. `kind` is a
  // Prisma ENUM, so /archive?kind=anything threw a validation error inside the
  // page render — and with no error boundary anywhere in the app that took the
  // whole route to Next's raw digest screen. Anyone could do it with a URL.
  // `order` two lines down was already allowlisted this way; this just joins
  // it.
  const requestedKind = params?.kind?.toString().trim() || "";
  const kind = KIND_OPTIONS.some(([value]) => value === requestedKind) ? requestedKind : "";
  const zoneId = params?.zoneId?.toString().trim() || "";
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
    ...(zoneId ? { zoneId } : {}),
    ...(characterId ? { characterId } : {}),
    ...(dayTurns ? { turnNumber: { in: dayTurns } } : {}),
    ...(q ? { content: { contains: q, mode: "insensitive" } } : {}),
  };

  const [entries, total, zones, characters] = await Promise.all([
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
    // Every zone a row can be stamped with, cave levels included — a line is
    // filed where it was said, not on the GM seat that owns the place.
    // Authoring order, so the list reads like the map rather than the alphabet.
    prisma.zone.findMany({ select: { id: true, name: true }, orderBy: { sortOrder: "asc" } }),
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
    const next = new URLSearchParams({ kind, zoneId, characterId, day, q, order, page: String(newPage) });
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
          <input name="q" defaultValue={q} placeholder="anything said…" />
        </label>
        <label className="field">
          <span className="field-label">Day</span>
          <input name="day" type="number" min="1" defaultValue={day} placeholder="any" />
        </label>
        <label className="field">
          <span className="field-label">Zone</span>
          <Select name="zoneId" defaultValue={zoneId}>
            <option value="">Anywhere</option>
            {zones.map((z) => (
              <option key={z.id} value={z.id}>
                {z.name}
              </option>
            ))}
          </Select>
        </label>
        <label className="field">
          <span className="field-label">Character</span>
          <Select name="characterId" defaultValue={characterId}>
            <option value="">Anyone</option>
            {characters.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </label>
        <label className="field">
          <span className="field-label">Kind</span>
          <Select name="kind" defaultValue={kind}>
            <option value="">Everything</option>
            {KIND_OPTIONS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </label>
        <label className="field">
          <span className="field-label">Order</span>
          <Select name="order" defaultValue={order}>
            <option value="asc">Oldest first</option>
            <option value="desc">Newest first</option>
          </Select>
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
