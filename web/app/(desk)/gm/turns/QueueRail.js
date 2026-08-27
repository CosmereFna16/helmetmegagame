"use client";

import { useMemo } from "react";
import StatusPill from "@/app/components/StatusPill";
import ZoneScopeToggle from "@/app/components/ZoneScopeToggle";
import { useTableState } from "@/app/components/DataTable";
import { MOVE_REVIEW_TONES } from "@/lib/moves";

// The left rail: the work queue as a compact list rather than a table.
// useTableState is list-generic — the same filter/search/sort engine every
// table uses, minus the table markup.

const MOVE_FILTER_DEFS = [
  { key: "zone", label: "Zone", value: (r) => r.factionZoneName },
  { key: "kind", label: "Kind", value: (r) => r.kindLabel },
  { key: "status", label: "Status", value: (r) => r.statusLabel },
];
const MOVE_SEARCH_FIELDS = [(r) => r.characterName, (r) => r.discordUsername, (r) => r.description];

const REQUEST_FILTER_DEFS = [
  { key: "zone", label: "Zone", value: (r) => r.factionZoneName },
  { key: "type", label: "Type", value: (r) => r.typeLabel },
  { key: "status", label: "Status", value: (r) => r.statusLabel },
];
const REQUEST_SEARCH_FIELDS = [(r) => r.characterName, (r) => r.discordUsername, (r) => r.reason, (r) => r.summary];

const REQUEST_TONES = { Passed: "neutral", Edited: "bad", Undone: "bad" };

function RailFilters({ table, filterDefs, myZoneName }) {
  return (
    <div className="desk-rail-filters">
      <label className="field">
        <span className="field-label">Search</span>
        <input
          value={table.query}
          onChange={(e) => table.setQuery(e.target.value)}
          placeholder="Name, text…"
        />
      </label>
      <div className="flex flex-wrap gap-2">
        {filterDefs.map((def) => (
          <label className="field min-w-0" style={{ flex: "1 1 6rem" }} key={def.key}>
            <span className="field-label">{def.label}</span>
            <select
              value={table.filters[def.key] ?? ""}
              onChange={(e) => table.setFilters((f) => ({ ...f, [def.key]: e.target.value }))}
            >
              <option value="">All</option>
              {table.options[def.key]?.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>
      <ZoneScopeToggle myZoneName={myZoneName} filters={table.filters} setFilters={table.setFilters} />
    </div>
  );
}

function MoveRows({ table, stagedByMove, selected, onSelect }) {
  return table.visible.map((row) => {
    const staged = stagedByMove.get(row.id);
    const stagedCount = (staged?.effects.length ?? 0) + (staged?.messages.length ?? 0);
    const active = selected?.type === "move" && selected.id === row.id;
    return (
      <button
        key={row.id}
        type="button"
        className="desk-queue-row"
        data-active={active}
        onClick={() => onSelect({ type: "move", id: row.id })}
      >
        <span className="flex items-center justify-between gap-2">
          <span className="truncate font-medium">{row.characterName}</span>
          <StatusPill tone={MOVE_REVIEW_TONES[row.statusLabel] ?? "neutral"}>{row.statusLabel}</StatusPill>
        </span>
        <span className="block truncate text-xs text-muted">
          {row.kindLabel}
          {row.opposed ? " · Opposed" : ""}
          {row.rollLabel ? ` · ${row.rollLabel}` : ""}
          {stagedCount ? ` · ${stagedCount} staged` : ""}
        </span>
        <span className="block truncate text-xs text-muted">{row.description}</span>
      </button>
    );
  });
}

function RequestRows({ table, selected, onSelect }) {
  return table.visible.map((row) => {
    const active = selected?.type === "request" && selected.id === row.id;
    const killPending = row.type === "FEED_PERSON" && !row.effect?.killed;
    return (
      <button
        key={row.id}
        type="button"
        className="desk-queue-row"
        data-active={active}
        data-urgent={killPending || undefined}
        onClick={() => onSelect({ type: "request", id: row.id })}
      >
        <span className="flex items-center justify-between gap-2">
          <span className="truncate font-medium">
            {killPending ? "☠ " : ""}
            {row.characterName}
          </span>
          <StatusPill tone={row.reviewedByUsername ? (REQUEST_TONES[row.statusLabel] ?? "neutral") : "warn"}>
            {row.reviewedByUsername ? row.statusLabel : "Unreviewed"}
          </StatusPill>
        </span>
        <span className="block truncate text-xs text-muted">
          {row.typeLabel} · {row.turnLabel}
        </span>
        <span className="block truncate text-xs text-muted">{row.summary || row.reason}</span>
      </button>
    );
  });
}

export default function QueueRail({
  moves,
  requests,
  myZoneName,
  stagedByMove,
  selected,
  onSelect,
  lens,
  onLens,
}) {
  const moveFilterDefs = useMemo(() => MOVE_FILTER_DEFS, []);
  const moveSearchFields = useMemo(() => MOVE_SEARCH_FIELDS, []);
  const requestFilterDefs = useMemo(() => REQUEST_FILTER_DEFS, []);
  const requestSearchFields = useMemo(() => REQUEST_SEARCH_FIELDS, []);

  // Both tables mount permanently so lens flips keep each one's filters; the
  // rail just shows one at a time. Page size is effectively "everything" —
  // the rail scrolls, and an open turn caps the set at the roster size.
  const moveTable = useTableState({
    rows: moves,
    filterDefs: moveFilterDefs,
    searchFields: moveSearchFields,
    initialSort: { key: "createdAtMs", dir: "desc" },
    initialFilters: myZoneName ? { zone: myZoneName } : undefined,
    pageSize: 1000,
  });
  const requestTable = useTableState({
    rows: requests,
    filterDefs: requestFilterDefs,
    searchFields: requestSearchFields,
    initialSort: { key: "createdAtMs", dir: "desc" },
    initialFilters: myZoneName ? { zone: myZoneName } : undefined,
    pageSize: 1000,
  });

  return (
    <aside className="desk-rail">
      <div className="segmented desk-rail-lens" role="group" aria-label="Queue lens">
        <button type="button" aria-pressed={lens !== "requests"} onClick={() => onLens?.("moves")}>
          Moves ({moveTable.total})
        </button>
        <button type="button" aria-pressed={lens === "requests"} onClick={() => onLens?.("requests")}>
          Requests ({requestTable.total})
        </button>
      </div>

      {lens === "requests" ? (
        <>
          <RailFilters table={requestTable} filterDefs={requestFilterDefs} myZoneName={myZoneName} />
          <div className="desk-queue">
            <RequestRows table={requestTable} selected={selected} onSelect={onSelect} />
            {requestTable.total === 0 && <p className="p-3 text-sm text-muted">No Requests match.</p>}
          </div>
        </>
      ) : (
        <>
          <RailFilters table={moveTable} filterDefs={moveFilterDefs} myZoneName={myZoneName} />
          <div className="desk-queue">
            <MoveRows table={moveTable} stagedByMove={stagedByMove} selected={selected} onSelect={onSelect} />
            {moveTable.total === 0 && <p className="p-3 text-sm text-muted">No Moves match.</p>}
          </div>
        </>
      )}
    </aside>
  );
}
