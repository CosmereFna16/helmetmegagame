"use client";

// Who holds a seat right now, DERIVED FROM TAGS rather than stored: a threat's
// seat tag is what makes them that threat, so a GM who grants it by hand from
// the character panel shows up here too, and there is no second copy of the
// truth to drift.
import { useMemo, useState, useTransition } from "react";
import { useTableState, SortHeader, FilterBar, TableScroll } from "@/app/components/DataTable";
import Pager from "@/app/components/Pager";
import EmptyState from "@/app/components/EmptyState";
import FormError from "@/app/components/FormError";
import CharacterLink from "@/app/components/CharacterLink";
import { useConfirm } from "@/app/components/ConfirmProvider";
import { cancelThreatSpawn } from "../threatActions";

const COL_COUNT = 8;

export default function ThreatRosterTable({ rows, pending, threats }) {
  const filterDefs = useMemo(
    () => [
      { key: "threat", label: "Threat", options: threats.map((t) => t.name), value: (r) => r.threatName },
      {
        key: "status",
        label: "Status",
        options: ["ALIVE", "DEAD", "CURSED"],
        value: (r) => r.status,
      },
    ],
    [threats],
  );

  const {
    query, setQuery, filters, setFilters, sort, toggleSort,
    options, pageRows, page, setPage, total, totalPages,
  } = useTableState({
    rows,
    searchFields: [(r) => r.characterName, (r) => r.handle, (r) => r.threatName],
    filterDefs,
    initialSort: { key: "threatName", dir: "asc" },
  });

  return (
    <div className="flex flex-col gap-4">
      <FilterBar
        filterDefs={filterDefs}
        filters={filters}
        setFilters={setFilters}
        options={options}
        query={query}
        setQuery={setQuery}
        searchLabel="Search"
        searchPlaceholder="Threat, character, or player… ‡"
      />

      <TableScroll minWidth="980px">
        <thead>
          <tr>
            <SortHeader label="Threat" sortKey="threatName" sort={sort} onSort={toggleSort} />
            <SortHeader label="Character" sortKey="characterName" sort={sort} onSort={toggleSort} />
            <SortHeader label="Player" sortKey="handle" sort={sort} onSort={toggleSort} />
            <SortHeader label="Status" sortKey="status" sort={sort} onSort={toggleSort} />
            <SortHeader label="Standing in" sortKey="locationName" sort={sort} onSort={toggleSort} />
            <SortHeader label="Resources" sortKey="resources" sort={sort} onSort={toggleSort} />
            <SortHeader label="Points" sortKey="tagPoints" sort={sort} onSort={toggleSort} />
            <SortHeader label="Since" sortKey="acquiredAt" sort={sort} onSort={toggleSort} />
          </tr>
        </thead>
        <tbody>
          {pageRows.map((r) => (
            <tr key={`${r.characterId}:${r.threatSlug}`}>
              <td>
                <span className="chip">{r.threatName}</span>
              </td>
              <td>
                <CharacterLink characterId={r.characterId} name={r.characterName} isGm />
              </td>
              <td className="mono">{r.handle}</td>
              <td>{r.status}</td>
              <td>
                {r.locationName ? (
                  `${r.zoneName} — ${r.locationName}`
                ) : (
                  <span className="text-muted">nowhere</span>
                )}
              </td>
              <td className="mono">{r.resources} ⬢</td>
              <td className="mono">{r.tagPoints}</td>
              <td className="mono">{r.acquiredAt}</td>
            </tr>
          ))}
          {pageRows.length === 0 ? (
            <tr>
              <td colSpan={COL_COUNT}>
                <EmptyState>Nobody holds a threat seat yet. ‡</EmptyState>
              </td>
            </tr>
          ) : null}
        </tbody>
      </TableScroll>

      <Pager page={page} totalPages={totalPages} total={total} unit="seats" onPage={setPage} />

      <PendingOffers rows={pending} />
    </div>
  );
}

// An offer nobody has answered is a thing a GM needs to see — otherwise the
// only trace of it is a DM in somebody else's client.
function PendingOffers({ rows }) {
  if (rows.length === 0) return null;
  return (
    <section className="desk-card flex flex-col gap-3">
      <h3 className="section-title">Offers waiting</h3>
      <p className="ops-lede">
        Sent, not yet answered. Cancelling kills the buttons on their end. ‡
      </p>
      <ul className="flex flex-col gap-2">
        {rows.map((r) => (
          <PendingRow key={r.id} row={r} />
        ))}
      </ul>
    </section>
  );
}

function PendingRow({ row }) {
  const confirm = useConfirm();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState(null);

  function cancel() {
    setError(null);
    startTransition(async () => {
      const ok = await confirm({
        title: `Cancel the ${row.threatName} offer?`,
        message: `${row.handle} won't be able to accept it. ‡`,
        confirmLabel: "Cancel the offer",
        cancelLabel: "Leave it",
      });
      if (!ok) return;
      const res = await cancelThreatSpawn({ spawnId: row.id });
      if (!res?.ok) setError(res?.error ?? "Something went wrong. ‡");
    });
  }

  return (
    <li className="flex flex-wrap items-center justify-between gap-3 rounded border p-3">
      <span>
        <span className="chip">{row.threatName}</span> offered to{" "}
        <span className="mono">{row.handle}</span> as {row.roleName}
        {row.locationName ? `, starting in ${row.locationName}` : null}
        <span className="mono text-xs text-muted"> · {row.createdAt}</span>
      </span>
      <span className="flex items-center gap-2">
        <FormError>{error}</FormError>
        <button type="button" className="btn-quiet" disabled={pending} onClick={cancel}>
          Cancel
        </button>
      </span>
    </li>
  );
}
