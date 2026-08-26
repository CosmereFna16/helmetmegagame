import { EmptyRow } from "@/app/components/EmptyState";
import { redirect } from "next/navigation";
import { prisma } from "@lifeweb/db";
import { getGmSession, listGuildMembers } from "@/lib/discordGuild";
import { isSuperadmin } from "@/lib/superadmin";
import CharacterLink from "../../../components/CharacterLink";
import PageShell, { PageHeader } from "@/app/components/PageShell";
import { TableScroll } from "@/app/components/DataTable";
import ExpandableText from "@/app/components/ExpandableText";
import Pager from "@/app/components/Pager";

// The six columns of the audit table below.
const COL_COUNT = 6;

const PAGE_SIZE = 50;
const NO_FACTION_LABEL = "No faction";

// Groups + sorts characters for the Target character <select>: factions
// alphabetical (No faction last), characters alphabetical within each.
function groupCharactersByFaction(characters) {
  const groups = new Map();
  for (const c of characters) {
    const key = c.faction?.name || NO_FACTION_LABEL;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(c);
  }
  const factionNames = [...groups.keys()]
    .filter((name) => name !== NO_FACTION_LABEL)
    .sort((a, b) => a.localeCompare(b));
  if (groups.has(NO_FACTION_LABEL)) factionNames.push(NO_FACTION_LABEL);
  return factionNames.map((name) => ({
    name,
    characters: groups.get(name).sort((a, b) => a.name.localeCompare(b.name)),
  }));
}

// A `YYYY-MM-DD` query param as a real Date, or null. Null is the right answer
// for anything unparseable: an unfiltered page is a reasonable response to a
// nonsense date, and a thrown Prisma error is not.
function parseDateParam(raw, timeSuffix) {
  const text = raw?.toString().trim();
  if (!text) return null;
  const parsed = new Date(`${text}${timeSuffix}`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export default async function AuditLogPage({ searchParams }) {
  // Superadmin, not GM. With five GMs the log stops being a shared work
  // surface and becomes a record OF them — including what each of them did to
  // their own zone — so it belongs to the master alone. listGuildMembers()
  // below is still needed to resolve actor names for the search.
  const { session, isGm: gm } = await getGmSession();
  if (!session?.discordUserId) redirect("/");
  if (!gm) redirect("/character");
  if (!isSuperadmin(session.discordUserId)) redirect("/gm/players");

  const params = await searchParams;
  const actionType = params?.actionType?.toString().trim() || "";
  const actor = params?.actor?.toString().trim() || "";
  const target = params?.target?.toString().trim() || "";
  const q = params?.q?.toString().trim() || "";
  // Parsed here rather than in the where clause below, and dropped if they
  // aren't real dates. new Date("banana") is an Invalid Date that Prisma
  // rejects, which threw inside the page render and — with no error boundary
  // in the app — took the whole route to a raw digest screen. The `to` branch
  // concatenated a time onto the string before parsing, so even a plausible
  // value could come out invalid.
  const from = parseDateParam(params?.from, "T00:00:00");
  const to = parseDateParam(params?.to, "T23:59:59");
  // What the two <input type="date"> fields echo back. Normalized off the
  // parsed value rather than the raw param, so a rejected date clears the box
  // instead of sitting there looking like an active filter.
  const fromValue = from ? from.toISOString().slice(0, 10) : "";
  const toValue = to ? to.toISOString().slice(0, 10) : "";
  const page = Math.max(1, Number.parseInt(params?.page?.toString() ?? "1", 10) || 1);

  const [allCharacters, guildMembers] = await Promise.all([
    prisma.character.findMany({
      select: { id: true, name: true, status: true, discordUserId: true, faction: { select: { name: true } } },
    }),
    listGuildMembers(),
  ]);
  const characterGroups = groupCharactersByFaction(allCharacters);

  // Free-text search: matches action type, actor Discord ID, actor's
  // Discord username / character name(s), or target character name.
  let qClauses = [];
  if (q) {
    const qLower = q.toLowerCase();
    const matchedActorIds = new Set([
      ...allCharacters.filter((c) => c.name.toLowerCase().includes(qLower)).map((c) => c.discordUserId),
      ...guildMembers.filter((m) => m.username?.toLowerCase().includes(qLower)).map((m) => m.id),
    ]);
    qClauses = [
      { actionType: { contains: q, mode: "insensitive" } },
      { actorDiscordUserId: { contains: q, mode: "insensitive" } },
      { targetCharacter: { name: { contains: q, mode: "insensitive" } } },
      ...(matchedActorIds.size ? [{ actorDiscordUserId: { in: [...matchedActorIds] } }] : []),
    ];
  }

  const where = {
    ...(actionType ? { actionType: { contains: actionType, mode: "insensitive" } } : {}),
    ...(actor ? { actorDiscordUserId: { contains: actor, mode: "insensitive" } } : {}),
    ...(target ? { targetCharacterId: target } : {}),
    ...(from || to
      ? {
          createdAt: {
            ...(from ? { gte: from } : {}),
            ...(to ? { lte: to } : {}),
          },
        }
      : {}),
    ...(qClauses.length ? { OR: qClauses } : {}),
  };

  const [entries, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: { targetCharacter: { select: { id: true, name: true } } },
    }),
    prisma.auditLog.count({ where }),
  ]);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const usernameById = new Map(guildMembers.map((m) => [m.id, m.username]));
  const characterByDiscordUserId = new Map();
  for (const c of allCharacters) {
    const existing = characterByDiscordUserId.get(c.discordUserId);
    if (!existing || c.status === "ALIVE") characterByDiscordUserId.set(c.discordUserId, c);
  }

  function pageHref(newPage) {
    // The normalized strings, not the Date objects — a Date in a
    // URLSearchParams stringifies to a full RFC date the next parse rejects.
    const next = new URLSearchParams({
      actionType,
      actor,
      target,
      q,
      from: fromValue,
      to: toValue,
      page: String(newPage),
    });
    for (const key of [...next.keys()]) {
      if (!next.get(key)) next.delete(key);
    }
    return `/gm/audit?${next.toString()}`;
  }

  return (
    <PageShell>
      <PageHeader title="Audit Log" />

      <form className="panel flex flex-wrap items-end gap-3 p-4">
        <label className="field">
          <span className="field-label">Search</span>
          <input name="q" defaultValue={q} placeholder="action, actor, character..." />
        </label>
        <label className="field">
          <span className="field-label">Action type</span>
          <input name="actionType" defaultValue={actionType} placeholder="e.g. resource_transfer" />
        </label>
        <label className="field">
          <span className="field-label">Actor Discord ID</span>
          <input name="actor" defaultValue={actor} />
        </label>
        <label className="field">
          <span className="field-label">Target character</span>
          <select name="target" defaultValue={target}>
            <option value="">Any</option>
            {characterGroups.map((group) => (
              <optgroup key={group.name} label={group.name}>
                {group.characters.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                    {c.status !== "ALIVE" ? ` (${c.status.toLowerCase()})` : ""}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field-label">From</span>
          <input type="date" name="from" defaultValue={fromValue} />
        </label>
        <label className="field">
          <span className="field-label">To</span>
          <input type="date" name="to" defaultValue={toValue} />
        </label>
        <button type="submit" className="btn">
          Filter
        </button>
      </form>

      {/* Same fixed-height, pinned-header frame every list in the app sits
          in — see web/app/components/DataTable.js. */}
      <TableScroll minWidth="900px">
        <thead>
          <tr>
            <th>Time</th>
            <th>Action</th>
            <th>Player</th>
            <th>Target</th>
            <th>Reason</th>
            <th>Details</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => (
            <tr key={entry.id}>
              <td className="whitespace-nowrap">{entry.createdAt.toISOString()}</td>
              <td>{entry.actionType}</td>
              <td className="whitespace-nowrap">
                {usernameById.get(entry.actorDiscordUserId) ?? entry.actorDiscordUserId}
                {characterByDiscordUserId.has(entry.actorDiscordUserId) ? (
                  <div className="text-xs text-muted">
                    <CharacterLink
                      characterId={characterByDiscordUserId.get(entry.actorDiscordUserId).id}
                      name={characterByDiscordUserId.get(entry.actorDiscordUserId).name}
                      isGm
                    />
                  </div>
                ) : null}
              </td>
              <td>
                <CharacterLink characterId={entry.targetCharacter?.id} name={entry.targetCharacter?.name} isGm />
              </td>
              {/* Only Request-backed entries carry a reason (see
                  web/lib/requests.js#logRequest); everything else is blank. */}
              <td className="col-text">
                <ExpandableText text={entry.reason ?? ""} />
              </td>
              {/* Pretty-printed, because the point of expanding a details
                  blob is to read it. It used to be a one-line `truncate`
                  cell, which made every entry longer than ~40 characters
                  unreadable with no way to see the rest. */}
              <td className="col-text">
                <ExpandableText
                  mono
                  lines={2}
                  className="text-xs"
                  text={entry.details ? JSON.stringify(entry.details, null, 2) : ""}
                />
              </td>
            </tr>
          ))}
          {entries.length === 0 && (
            <EmptyRow cols={COL_COUNT}>No entries match these filters.</EmptyRow>
          )}
        </tbody>
      </TableScroll>

      {/* Server-side paging: /gm/audit keeps its page in the URL so a
          filtered view stays linkable, which is why Pager takes hrefs here
          rather than the callback the in-memory tables pass. */}
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
