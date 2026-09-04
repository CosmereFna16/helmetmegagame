"use client";

// Every approved player in the guild, whether or not they are in the game —
// because a SPAWN is aimed at exactly the people who are not. A row with no
// character is a real row, not a gap.
import { useMemo, useState, useTransition } from "react";
import { useTableState, SortHeader, FilterBar, TableScroll } from "@/app/components/DataTable";
import Pager from "@/app/components/Pager";
import Modal from "@/app/components/Modal";
import Select from "@/app/components/Select";
import FormError from "@/app/components/FormError";
import EmptyState from "@/app/components/EmptyState";
import CharacterLink from "@/app/components/CharacterLink";
import { useConfirm } from "@/app/components/ConfirmProvider";
import { assignThreat, offerThreatSpawn } from "../threatActions";
import { sendGmDm } from "@/app/(desk)/gm/players/actions";

const COL_COUNT = 8;

export default function ThreatAssignmentsTable({ rows, threats, roles, locations }) {
  const [spawnFor, setSpawnFor] = useState(null);
  const [messageFor, setMessageFor] = useState(null);

  // Opt-ins are the one MULTI-valued cell here, and useTableState compares a
  // filter by string equality — an array would stringify and "Archon" would
  // miss anyone who also ticked Warlock. So this one is a membership test
  // applied BEFORE the table sees the rows, and its dropdown rides in
  // FilterBar's children rather than in filterDefs.
  const [optIn, setOptIn] = useState("");
  const visibleRows = useMemo(
    () => (optIn ? rows.filter((r) => r.optInNames.includes(optIn)) : rows),
    [rows, optIn],
  );
  // Counts for that dropdown, measured over every row: the fixed vocabulary
  // means a seat nobody picked still lists, at zero.
  const optInThreats = useMemo(() => threats.filter((t) => t.optIn), [threats]);
  const optInCounts = useMemo(() => {
    const counts = new Map(optInThreats.map((t) => [t.name, 0]));
    for (const r of rows) for (const name of r.optInNames) counts.set(name, (counts.get(name) ?? 0) + 1);
    return counts;
  }, [rows, optInThreats]);

  // The rest are single-valued, with fixed vocabularies for the same reason
  // RosterTable pins its Status options: a value nobody holds this game should
  // still be in the dropdown.
  const filterDefs = useMemo(
    () => [
      { key: "inGame", label: "In game", options: ["Yes", "No"], value: (r) => (r.characterId ? "Yes" : "No") },
      {
        key: "seat",
        label: "Seat",
        options: threats.filter((t) => t.assignable).map((t) => t.name),
        value: (r) => r.seatName ?? "",
      },
    ],
    [threats],
  );

  const {
    query, setQuery, filters, setFilters, sort, toggleSort,
    options, pageRows, page, setPage, total, totalPages,
  } = useTableState({
    rows: visibleRows,
    searchFields: [(r) => r.handle, (r) => r.characterName ?? "", (r) => r.roleTitle ?? ""],
    filterDefs,
    initialSort: { key: "handle", dir: "asc" },
  });

  return (
    <div className="flex flex-col gap-3">
      <FilterBar
        filterDefs={filterDefs}
        filters={filters}
        setFilters={setFilters}
        options={options}
        query={query}
        setQuery={setQuery}
        searchLabel="Search"
        searchPlaceholder="Player, character, or role… ‡"
      >
        <label className="field">
          <span className="field-label">Opted into</span>
          <Select
            value={optIn}
            onChange={(e) => {
              setOptIn(e.target.value);
              setPage(1);
            }}
          >
            <option value="">All</option>
            {optInThreats.map((t) => (
              <option key={t.slug} value={t.name}>
                {t.name} ({optInCounts.get(t.name) ?? 0})
              </option>
            ))}
          </Select>
        </label>
      </FilterBar>

      <TableScroll minWidth="1080px">
        <thead>
          <tr>
            <SortHeader label="Player" sortKey="handle" sort={sort} onSort={toggleSort} />
            <SortHeader label="Character" sortKey="characterName" sort={sort} onSort={toggleSort} />
            <SortHeader label="Role" sortKey="roleTitle" sort={sort} onSort={toggleSort} />
            <SortHeader label="Zone" sortKey="zoneName" sort={sort} onSort={toggleSort} />
            <SortHeader label="Status" sortKey="statusLabel" sort={sort} onSort={toggleSort} />
            <th scope="col">Opted into</th>
            <SortHeader label="Seat" sortKey="seatName" sort={sort} onSort={toggleSort} />
            <th scope="col">Actions</th>
          </tr>
        </thead>
        <tbody>
          {pageRows.map((r) => (
            <Row
              key={r.discordUserId}
              row={r}
              threats={threats}
              onSpawn={() => setSpawnFor(r)}
              onMessage={() => setMessageFor(r)}
            />
          ))}
          {pageRows.length === 0 ? (
            <tr>
              <td colSpan={COL_COUNT}>
                <EmptyState>Nobody matches that. ‡</EmptyState>
              </td>
            </tr>
          ) : null}
        </tbody>
      </TableScroll>

      <Pager page={page} totalPages={totalPages} total={total} unit="players" onPage={setPage} />

      {spawnFor ? (
        <SpawnDialog
          row={spawnFor}
          threats={threats.filter((t) => t.assignable)}
          roles={roles}
          locations={locations}
          onClose={() => setSpawnFor(null)}
        />
      ) : null}
      {messageFor ? <MessageDialog row={messageFor} onClose={() => setMessageFor(null)} /> : null}
    </div>
  );
}

function Row({ row, threats, onSpawn, onMessage }) {
  const confirm = useConfirm();
  const [pending, startTransition] = useTransition();
  const [slug, setSlug] = useState("");
  const [error, setError] = useState(null);

  const assignable = threats.filter((t) => t.assignable);

  function assign() {
    const threat = assignable.find((t) => t.slug === slug);
    if (!threat) return;
    setError(null);
    startTransition(async () => {
      const ok = await confirm({
        title: `Make ${row.characterName} the ${threat.name}?`,
        message: `They get the seat's tags and ${threat.tagPoints} tag points, and a DM telling them so. ‡`,
        confirmLabel: "Assign",
      });
      if (!ok) return;
      const res = await assignThreat({ characterId: row.characterId, threatSlug: slug });
      if (!res?.ok) {
        setError(res?.error ?? "Something went wrong. ‡");
        return;
      }
      setSlug("");
    });
  }

  return (
    <tr>
      <td className="mono">{row.handle}</td>
      <td>
        {row.characterId ? (
          <CharacterLink characterId={row.characterId} name={row.characterName} isGm />
        ) : (
          <span className="text-muted">—</span>
        )}
      </td>
      <td>{row.roleTitle ?? <span className="text-muted">—</span>}</td>
      <td>{row.zoneName ?? <span className="text-muted">—</span>}</td>
      <td>{row.statusLabel}</td>
      <td>
        {row.optInNames.length === 0 ? (
          <span className="text-muted">—</span>
        ) : (
          <span className="flex flex-wrap gap-1">
            {row.optInNames.map((name) => (
              <span key={name} className="chip">
                {name}
              </span>
            ))}
          </span>
        )}
      </td>
      <td>{row.seatName ? <span className="chip">{row.seatName}</span> : <span className="text-muted">—</span>}</td>
      <td>
        <div className="flex flex-wrap items-center gap-2">
          {row.characterId ? (
            <>
              <Select value={slug} onChange={(e) => setSlug(e.target.value)} aria-label="Threat to assign">
                <option value="">Assign…</option>
                {assignable.map((t) => (
                  <option key={t.slug} value={t.slug}>
                    {t.name}
                  </option>
                ))}
              </Select>
              <button type="button" className="btn-quiet" disabled={pending || !slug} onClick={assign}>
                Assign
              </button>
            </>
          ) : null}
          <button type="button" className="btn-quiet" onClick={onSpawn}>
            Spawn
          </button>
          <button type="button" className="btn-quiet" onClick={onMessage}>
            Message
          </button>
        </div>
        <FormError>{error}</FormError>
      </td>
    </tr>
  );
}

// Threat, starting role, starting location. The role dropdown is pinned when
// the seat names its own; neither shipping seat does, so a GM picks.
function SpawnDialog({ row, threats, roles, locations, onClose }) {
  const [pending, startTransition] = useTransition();
  const [slug, setSlug] = useState(threats[0]?.slug ?? "");
  const [roleId, setRoleId] = useState("");
  const [locationId, setLocationId] = useState("");
  const [error, setError] = useState(null);
  const [done, setDone] = useState(null);

  const threat = threats.find((t) => t.slug === slug) ?? null;
  const pinnedRole = threat?.spawnRoleSlug ? roles.find((r) => r.slug === threat.spawnRoleSlug) : null;
  const role = pinnedRole ?? roles.find((r) => r.id === roleId) ?? null;

  // The role's own start is the default, and the picker only overrides it.
  const effectiveLocationId = locationId || role?.startingLocationId || "";

  function send() {
    setError(null);
    startTransition(async () => {
      const res = await offerThreatSpawn({
        discordUserId: row.discordUserId,
        threatSlug: slug,
        roleId: pinnedRole ? undefined : roleId,
        locationId: effectiveLocationId || undefined,
      });
      if (!res?.ok) {
        setError(res?.error ?? "Something went wrong. ‡");
        return;
      }
      setDone(`Offered ${res.threat} to ${row.handle}, starting as ${res.role}. ‡`);
    });
  }

  return (
    <Modal open title={`Spawn a threat for ${row.handle}`} onClose={onClose}>
      <div className="flex flex-col gap-3">
        <p className="text-sm text-muted">
          They get a DM with the seat&rsquo;s brief and two buttons. Accepting makes the character
          immediately, if the role still has a seat open. ‡
        </p>

        <label className="field">
          <span className="field-label">Threat</span>
          <Select value={slug} onChange={(e) => setSlug(e.target.value)}>
            {threats.map((t) => (
              <option key={t.slug} value={t.slug}>
                {t.name}
              </option>
            ))}
          </Select>
        </label>

        <label className="field">
          <span className="field-label">Starting role</span>
          <Select
            value={pinnedRole ? pinnedRole.id : roleId}
            disabled={Boolean(pinnedRole)}
            onChange={(e) => {
              setRoleId(e.target.value);
              setLocationId("");
            }}
          >
            <option value="">Choose a role… ‡</option>
            {roles.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name} ({r.seatsLeft} left)
              </option>
            ))}
          </Select>
        </label>

        <label className="field">
          <span className="field-label">Starting location</span>
          <Select value={effectiveLocationId} onChange={(e) => setLocationId(e.target.value)}>
            <option value="">Wherever the role starts ‡</option>
            {locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.zoneName} — {l.name}
              </option>
            ))}
          </Select>
        </label>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="btn"
            disabled={pending || Boolean(done) || (!pinnedRole && !roleId)}
            onClick={send}
          >
            {pending ? "Offering… ‡" : "Send the offer"}
          </button>
          <button type="button" className="btn-quiet" onClick={onClose}>
            Close
          </button>
        </div>
        <FormError>{error}</FormError>
        {done ? <p className="text-sm text-muted">{done}</p> : null}
      </div>
    </Modal>
  );
}

// The same DM plumbing /gm/players uses — one composer, one posture, wherever
// a GM writes to a player.
function MessageDialog({ row, onClose }) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState("");
  const [error, setError] = useState(null);
  const [sent, setSent] = useState(false);

  function send() {
    const trimmed = message.trim();
    if (!trimmed) return;
    setError(null);
    startTransition(async () => {
      const res = await sendGmDm({
        discordUserId: row.discordUserId,
        content: trimmed,
        source: "gm_dev_panel",
      });
      if (!res?.ok) {
        setError(res?.error ?? "Something went wrong. ‡");
        return;
      }
      setSent(true);
      setMessage("");
    });
  }

  return (
    <Modal open title={`Message ${row.handle}`} onClose={onClose}>
      <div className="flex flex-col gap-3">
        <label className="field">
          <span className="field-label">Message (sent from Bascinet)</span>
          <textarea rows={4} value={message} onChange={(e) => setMessage(e.target.value)} />
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className="btn" disabled={pending || !message.trim()} onClick={send}>
            {pending ? "Sending… ‡" : "Send"}
          </button>
          <button type="button" className="btn-quiet" onClick={onClose}>
            Close
          </button>
        </div>
        <FormError>{error}</FormError>
        {sent ? <p className="text-sm text-muted">Sent. ‡</p> : null}
      </div>
    </Modal>
  );
}
