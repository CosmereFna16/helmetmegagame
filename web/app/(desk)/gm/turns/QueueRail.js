"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import StatusPill from "@/app/components/StatusPill";
import ZoneScopeToggle from "@/app/components/ZoneScopeToggle";
import GmAvatar from "@/app/components/GmAvatar";
import { useTableState } from "@/app/components/DataTable";
import { useIsCoarsePointer } from "@/app/components/useIsCoarsePointer";
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
  { key: "reviewed", label: "Reviewed", value: (r) => (r.reviewedByUsername ? "Reviewed" : "Unreviewed") },
];
const REQUEST_SEARCH_FIELDS = [(r) => r.characterName, (r) => r.discordUsername, (r) => r.reason, (r) => r.summary];

const REQUEST_TONES = { Passed: "neutral", Edited: "neutral", Undone: "bad" };

// The Caving lens — see docs/systemdocs/CAVING.md. Only a TROUBLE (die 1)
// row is ever "Needs attention"; QUIET and FIND are stamped resolved at
// creation, so that's the default filter and, in practice, the whole list a
// GM ever needs to open.
const CAVING_FILTER_DEFS = [
  { key: "zone", label: "Zone", value: (r) => r.factionZoneName },
  { key: "status", label: "Status", value: (r) => r.statusLabel },
];
const CAVING_SEARCH_FIELDS = [(r) => r.characterName, (r) => r.discordUsername, (r) => r.lootTagName];
const CAVING_TONES = { "Needs attention": "bad", Resolved: "neutral" };

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

function MoveRows({ table, stagedByMove, selected, onSelect, gmProfiles, kbdId, kbdLens }) {
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
        data-kbd={kbdLens === "moves" && kbdId === row.id ? "" : undefined}
        data-row-key={row.id}
        onClick={() => onSelect({ type: "move", id: row.id })}
      >
        <span className="flex items-center justify-between gap-2">
          <span className="truncate font-medium">{row.characterName}</span>
          <span className="flex items-center gap-1.5">
            {row.statusLabel === "In Progress" && (
              <GmAvatar profile={gmProfiles?.[row.lockedByDiscordUserId]} size={14} />
            )}
            <StatusPill tone={MOVE_REVIEW_TONES[row.statusLabel] ?? "neutral"}>{row.statusLabel}</StatusPill>
          </span>
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

function RequestRows({ table, selected, onSelect, kbdId, kbdLens }) {
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
        data-kbd={kbdLens === "requests" && kbdId === row.id ? "" : undefined}
        data-row-key={row.id}
        onClick={() => onSelect({ type: "request", id: row.id })}
      >
        <span className="flex items-center justify-between gap-2">
          <span className="truncate font-medium">
            {killPending ? "☠ " : ""}
            {!row.reviewedByUsername && <span className="desk-dot" aria-label="Not yet reviewed" />}
            {row.characterName}
          </span>
          <StatusPill tone={REQUEST_TONES[row.statusLabel] ?? "neutral"}>{row.statusLabel}</StatusPill>
        </span>
        <span className="block truncate text-xs text-muted">
          {row.typeLabel} · {row.turnLabel}
        </span>
        <span className="block truncate text-xs text-muted">{row.summary || row.reason}</span>
      </button>
    );
  });
}

function CavingRows({ table, selected, onSelect, kbdId, kbdLens }) {
  return table.visible.map((row) => {
    const active = selected?.type === "caving" && selected.id === row.id;
    return (
      <button
        key={row.id}
        type="button"
        className="desk-queue-row"
        data-active={active}
        data-urgent={row.statusLabel === "Needs attention" || undefined}
        data-kbd={kbdLens === "caving" && kbdId === row.id ? "" : undefined}
        data-row-key={row.id}
        onClick={() => onSelect({ type: "caving", id: row.id })}
      >
        <span className="flex items-center justify-between gap-2">
          <span className="truncate font-medium">
            ⚀ {row.die} — {row.characterName}
          </span>
          <StatusPill tone={CAVING_TONES[row.statusLabel] ?? "neutral"}>{row.statusLabel}</StatusPill>
        </span>
        <span className="block truncate text-xs text-muted">
          {row.factionZoneName} · {row.kindLabel}
        </span>
        {row.lootTagName && <span className="block truncate text-xs text-muted">{row.lootTier} → {row.lootTagName}</span>}
      </button>
    );
  });
}

export default function QueueRail({
  moves,
  requests,
  cavingRolls,
  myZoneName,
  stagedByMove,
  selected,
  onSelect,
  lens,
  onLens,
  gmProfiles,
}) {
  const moveFilterDefs = useMemo(() => MOVE_FILTER_DEFS, []);
  const moveSearchFields = useMemo(() => MOVE_SEARCH_FIELDS, []);
  const requestFilterDefs = useMemo(() => REQUEST_FILTER_DEFS, []);
  const requestSearchFields = useMemo(() => REQUEST_SEARCH_FIELDS, []);
  const cavingFilterDefs = useMemo(() => CAVING_FILTER_DEFS, []);
  const cavingSearchFields = useMemo(() => CAVING_SEARCH_FIELDS, []);

  // All three tables mount permanently so lens flips keep each one's
  // filters; the rail just shows one at a time. Page size is effectively
  // "everything" — the rail scrolls, and an open turn caps the set at the
  // roster size.
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
  const cavingTable = useTableState({
    rows: cavingRolls ?? [],
    filterDefs: cavingFilterDefs,
    searchFields: cavingSearchFields,
    initialSort: { key: "createdAtMs", dir: "desc" },
    // "Needs attention" only ever matches an unresolved TROUBLE row — QUIET
    // and FIND are stamped resolved at creation — so this is what keeps a
    // hundred quiet 2-5s off the rail by default.
    initialFilters: { status: "Needs attention", ...(myZoneName ? { zone: myZoneName } : {}) },
    pageSize: 1000,
  });

  const tableForLens = { moves: moveTable, requests: requestTable, caving: cavingTable }[lens] ?? moveTable;
  const visibleRows = tableForLens.visible;
  const [kbdIndex, setKbdIndex] = useState(-1);
  const railRef = useRef(null);
  const coarse = useIsCoarsePointer();

  // Filter/lens changes invalidate any prior focus position — clamped rather
  // than reset-in-an-effect, since this is a plain derived value at read time.
  const clampedKbdIndex = visibleRows.length ? Math.min(kbdIndex, visibleRows.length - 1) : -1;
  const kbdId = clampedKbdIndex >= 0 ? visibleRows[clampedKbdIndex]?.id : null;

  useEffect(() => {
    // No keyboard on a touch-primary device — skip wiring the listener.
    if (coarse) return undefined;
    function onKey(e) {
      const key = e.key;
      const isNav = key === "ArrowDown" || key === "ArrowUp" || key === "j" || key === "k" || key === "Enter";
      const isLensKey = key === "m" || key === "r" || key === "c";
      if (!isNav && !isLensKey) return;
      if (document.querySelector(".modal-overlay")) return;
      const active = document.activeElement;
      if (active && ["INPUT", "TEXTAREA", "SELECT"].includes(active.tagName)) return;

      if (isLensKey) {
        onLens?.(key === "m" ? "moves" : key === "r" ? "requests" : "caving");
        setKbdIndex(-1);
        return;
      }

      const rows = { moves: moveTable.visible, requests: requestTable.visible, caving: cavingTable.visible }[lens] ?? [];
      if (!rows.length) return;

      if (key === "Enter") {
        const row = clampedKbdIndex >= 0 ? rows[clampedKbdIndex] : null;
        if (row) onSelect({ type: lens === "requests" ? "request" : lens === "caving" ? "caving" : "move", id: row.id });
        return;
      }

      e.preventDefault();
      // Computed out here rather than inside the updater: React may call an
      // updater twice, and scrolling is a side effect.
      const delta = key === "ArrowDown" || key === "j" ? 1 : -1;
      const next = Math.max(0, Math.min(rows.length - 1, clampedKbdIndex + delta));
      setKbdIndex(next);
      railRef.current?.querySelector(`[data-row-key="${rows[next].id}"]`)?.scrollIntoView({ block: "nearest" });
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lens, onLens, onSelect, moveTable.visible, requestTable.visible, cavingTable.visible, clampedKbdIndex, coarse]);

  return (
    <aside className="desk-rail" ref={railRef}>
      <div className="segmented desk-rail-lens" role="group" aria-label="Queue lens">
        <button type="button" aria-pressed={lens === "moves" || !lens} onClick={() => onLens?.("moves")}>
          Moves ({moveTable.total})
        </button>
        <button type="button" aria-pressed={lens === "requests"} onClick={() => onLens?.("requests")}>
          Requests
        </button>
        <button type="button" aria-pressed={lens === "caving"} onClick={() => onLens?.("caving")}>
          Caving
        </button>
      </div>

      {lens === "requests" ? (
        <>
          <RailFilters table={requestTable} filterDefs={requestFilterDefs} myZoneName={myZoneName} />
          <div className="desk-queue">
            <RequestRows table={requestTable} selected={selected} onSelect={onSelect} kbdId={kbdId} kbdLens={lens} />
            {requestTable.total === 0 && <p className="p-3 text-sm text-muted">No Requests match.</p>}
          </div>
        </>
      ) : lens === "caving" ? (
        <>
          <RailFilters table={cavingTable} filterDefs={cavingFilterDefs} myZoneName={myZoneName} />
          <div className="desk-queue">
            <CavingRows table={cavingTable} selected={selected} onSelect={onSelect} kbdId={kbdId} kbdLens={lens} />
            {cavingTable.total === 0 && <p className="p-3 text-sm text-muted">No Caving rolls match.</p>}
          </div>
        </>
      ) : (
        <>
          <RailFilters table={moveTable} filterDefs={moveFilterDefs} myZoneName={myZoneName} />
          <div className="desk-queue">
            <MoveRows
              table={moveTable}
              stagedByMove={stagedByMove}
              selected={selected}
              onSelect={onSelect}
              gmProfiles={gmProfiles}
              kbdId={kbdId}
              kbdLens={lens}
            />
            {moveTable.total === 0 && <p className="p-3 text-sm text-muted">No Moves match.</p>}
          </div>
        </>
      )}
      <p className="desk-rail-hint text-xs text-muted">↑↓ / j k navigate · ⏎ open · m/r/c lens · esc close</p>
    </aside>
  );
}
