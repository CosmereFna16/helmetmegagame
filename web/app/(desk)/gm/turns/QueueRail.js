"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import StatusPill from "@/app/components/StatusPill";
import ZoneScopeToggle from "@/app/components/ZoneScopeToggle";
import Select from "@/app/components/Select";
import { openingZoneName } from "@/lib/zones";
import GmAvatar from "@/app/components/GmAvatar";
import CharacterAvatar from "@/app/components/CharacterAvatar";
import { useTableState } from "@/app/components/DataTable";
import { useIsCoarsePointer } from "@/app/components/useIsCoarsePointer";
import { MOVE_REVIEW_TONES, MOVE_REVIEW_LABELS } from "@/lib/moves";
import { REQUEST_TYPE_LABELS, REQUEST_STATUS_LABELS } from "@/lib/requestLabels";

// The left rail: the work queue as a compact list rather than a table.
// useTableState is list-generic — the same filter/search/sort engine every
// table uses, minus the table markup.

// Fixed vocabularies for the enum-backed dropdowns — every value always
// listed, even at a count of zero, so "Open" doesn't disappear from Status
// just because nothing is open right now. Zone stays derived from the loaded
// rows in every filterDefs list below, since which zones exist is not a
// fixed thing. WAITING_FOR_OPPONENTS is dropped: legacy, nothing writes it
// (see web/lib/moves.js).
const MOVE_KIND_OPTIONS = ["Routine", "Gambit", "Travel"];
const MOVE_STATUS_OPTIONS = Object.values(MOVE_REVIEW_LABELS).filter((l) => l !== "Waiting for Opponents");

// Still-open work floats to the top of the rail; Solved (bookkept, nothing
// left to push) and Passed (already resolved) sink toward the bottom. Ties
// within a rank fall back to recency — see queueOrder below.
const MOVE_STATUS_RANK = { Open: 0, "In Progress": 0, "Waiting for Opponents": 0, Solved: 1, Passed: 2 };
const REQUEST_TYPE_OPTIONS = [...new Set(Object.values(REQUEST_TYPE_LABELS))];
const REQUEST_STATUS_OPTIONS = Object.values(REQUEST_STATUS_LABELS);
const REVIEWED_OPTIONS = ["Reviewed", "Unreviewed"];
const CAVING_STATUS_OPTIONS = ["Needs attention", "Resolved"];

const MOVE_FILTER_DEFS = [
  { key: "zone", label: "Zone", value: (r) => r.factionZoneName },
  { key: "kind", label: "Kind", value: (r) => r.kindLabel, options: MOVE_KIND_OPTIONS },
  { key: "status", label: "Status", value: (r) => r.statusLabel, options: MOVE_STATUS_OPTIONS },
];
// scoreMatch fields (web/lib/fuzzySearch.js) — everything already on the DTO
// ([[...selection]]/page.js), so this costs no new query. `kind` doubles as
// "Routine"/"Gambit"/"Travel" and `status` as Open/Solved/etc, both already
// covered by the Kind/Status dropdowns above but useful as bare search terms
// too ("gambit open"). A Move's `tags` only carries tagIds, so tag NAME
// search needs the catalog lookup Workspace already threads everywhere else
// — hence the factory rather than a plain module-level function.
function makeMoveSearchMap(tagsById) {
  return (r) => ({
    name: r.characterName,
    username: r.discordUsername,
    role: r.roleTitle,
    faction: r.factionName,
    zone: `${r.factionZoneName ?? ""} ${r.locationLabel ?? ""}`,
    tag: (r.tags ?? []).map((t) => tagsById?.[t.tagId]?.name ?? "").join(" "),
    kind: r.kindLabel,
    status: r.statusLabel,
    text: r.description,
    notes: [r.resultMessage, r.gmNotes].filter(Boolean).join(" "),
  });
}

const REQUEST_FILTER_DEFS = [
  { key: "zone", label: "Zone", value: (r) => r.factionZoneName },
  { key: "type", label: "Type", value: (r) => r.typeLabel, options: REQUEST_TYPE_OPTIONS },
  { key: "status", label: "Status", value: (r) => r.statusLabel, options: REQUEST_STATUS_OPTIONS },
  {
    key: "reviewed",
    label: "Reviewed",
    value: (r) => (r.reviewedByUsername ? "Reviewed" : "Unreviewed"),
    options: REVIEWED_OPTIONS,
  },
];
const requestSearchMap = (r) => ({
  name: r.characterName,
  username: r.discordUsername,
  role: r.roleTitle,
  faction: r.factionName,
  zone: r.factionZoneName,
  kind: r.typeLabel,
  status: r.statusLabel,
  text: [r.reason, r.summary].filter(Boolean).join(" "),
  notes: r.gmNotes,
});

const REQUEST_TONES = { Passed: "neutral", Edited: "neutral", Undone: "bad" };

// The Caving lens — see docs/systemdocs/CAVING.md. Only a TROUBLE (die 1)
// row is ever "Needs attention"; QUIET and FIND are stamped resolved at
// creation, so that's the default filter and, in practice, the whole list a
// GM ever needs to open.
const CAVING_FILTER_DEFS = [
  { key: "zone", label: "Zone", value: (r) => r.factionZoneName },
  { key: "status", label: "Status", value: (r) => r.statusLabel, options: CAVING_STATUS_OPTIONS },
];
const cavingSearchMap = (r) => ({
  name: r.characterName,
  username: r.discordUsername,
  role: r.roleTitle,
  faction: r.factionName,
  zone: r.factionZoneName,
  kind: r.kindLabel,
  status: r.statusLabel,
  tag: r.lootTagName,
});
const CAVING_TONES = { "Needs attention": "bad", Resolved: "neutral" };

// The match-reason subtext — only worth showing when the hit came off a
// field other than the name everyone can already see on the row.
function MatchHint({ match }) {
  if (!match || match.matchedField === "name") return null;
  return <span className="text-xs text-muted"> · {match.matchedField}</span>;
}

function RailFilters({ table, filterDefs, myZoneNames, searchPlaceholder, children }) {
  return (
    <div className="desk-rail-filters">
      <label className="field">
        <span className="field-label">Search</span>
        <input
          value={table.query}
          onChange={(e) => table.setQuery(e.target.value)}
          placeholder={searchPlaceholder}
        />
      </label>
      <div className="flex flex-wrap gap-2">
        {filterDefs.map((def) => (
          <label className="field min-w-0" style={{ flex: "1 1 6rem" }} key={def.key}>
            <span className="field-label">{def.label}</span>
            <Select
              value={table.filters[def.key] ?? ""}
              onChange={(e) => table.setFilters((f) => ({ ...f, [def.key]: e.target.value }))}
            >
              <option value="">All</option>
              {table.options[def.key]?.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.value} ({o.count})
                </option>
              ))}
            </Select>
          </label>
        ))}
      </div>
      <ZoneScopeToggle myZoneNames={myZoneNames} filters={table.filters} setFilters={table.setFilters} />
      {children}
    </div>
  );
}

function MoveRows({ rows, matchFor, stagedByMove, selected, onSelect, gmProfiles, kbdId, kbdLens }) {
  return rows.map((row) => {
    const staged = stagedByMove.get(row.id);
    const stagedCount = (staged?.effects.length ?? 0) + (staged?.messages.length ?? 0);
    const active = selected?.type === "move" && selected.id === row.id;
    return (
      <button
        key={row.id}
        type="button"
        className="desk-queue-row"
        data-active={active}
        data-auto={row.isTravel || undefined}
        data-kbd={kbdLens === "moves" && kbdId === row.id ? "" : undefined}
        data-row-key={row.id}
        onClick={() => onSelect({ type: "move", id: row.id })}
      >
        <span className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-1.5 truncate font-medium">
            <CharacterAvatar characterId={row.characterId} name={row.characterName} version={row.avatarVersion} />
            <span className="truncate">{row.characterName}</span>
            <MatchHint match={matchFor(row)} />
          </span>
          <span className="flex items-center gap-1.5">
            {row.statusLabel === "In Progress" && (
              <GmAvatar profile={gmProfiles?.[row.lockedByDiscordUserId]} size={14} />
            )}
            <StatusPill tone={MOVE_REVIEW_TONES[row.statusLabel] ?? "neutral"}>{row.statusLabel}</StatusPill>
          </span>
        </span>
        <span className="block truncate text-xs text-muted">
          {row.kindLabel}
          {row.rollLabel ? ` · ${row.rollLabel}` : ""}
          {stagedCount ? ` · ${stagedCount} staged` : ""}
        </span>
        <span className="block truncate text-xs text-muted">{row.description}</span>
      </button>
    );
  });
}

function RequestRows({ rows, matchFor, selected, onSelect, kbdId, kbdLens }) {
  return rows.map((row) => {
    const active = selected?.type === "request" && selected.id === row.id;
    // Both types that can name someone to kill without killing them.
    // See killRequestTargetImpl in actions.js.
    const killPending =
      (row.type === "FEED_PERSON" || (row.type === "HARM_CHARACTER" && row.effect?.lethal)) &&
      !row.effect?.killed;
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
          <span className="flex items-center gap-1.5 truncate font-medium">
            <CharacterAvatar characterId={row.characterId} name={row.characterName} version={row.avatarVersion} />
            <span className="truncate">
              {killPending ? "☠ " : ""}
              {!row.reviewedByUsername && <span className="desk-dot" aria-label="Not yet reviewed" />}
              {row.characterName}
            </span>
            <MatchHint match={matchFor(row)} />
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

function CavingRows({ rows, matchFor, selected, onSelect, kbdId, kbdLens }) {
  return rows.map((row) => {
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
          <span className="flex items-center gap-1.5 truncate font-medium">
            <CharacterAvatar characterId={row.characterId} name={row.characterName} version={row.avatarVersion} />
            <span className="truncate">
              ⚀ {row.die} — {row.characterName}
            </span>
            <MatchHint match={matchFor(row)} />
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
  myZoneNames,
  stagedByMove,
  selected,
  onSelect,
  lens,
  onLens,
  gmProfiles,
  tagsById,
}) {
  const moveFilterDefs = useMemo(() => MOVE_FILTER_DEFS, []);
  const requestFilterDefs = useMemo(() => REQUEST_FILTER_DEFS, []);
  const cavingFilterDefs = useMemo(() => CAVING_FILTER_DEFS, []);
  const moveSearchMap = useMemo(() => makeMoveSearchMap(tagsById), [tagsById]);

  // A single numeric key so the generic engine's one-field sort can still
  // rank by status first and recency second: status dominates (multiplied up
  // out of recency's range) and createdAtMs is subtracted so that, within a
  // rank, the more recent Move sorts first under the same ascending order.
  const rankedMoves = useMemo(
    () =>
      moves.map((r) => ({
        ...r,
        queueOrder: (MOVE_STATUS_RANK[r.statusLabel] ?? 0) * 1e15 - r.createdAtMs,
      })),
    [moves],
  );

  // All three tables mount permanently so lens flips keep each one's
  // filters; the rail just shows one at a time. Page size is effectively
  // "everything" — the rail scrolls, and an open turn caps the set at the
  // roster size. rankBySearch: true because this list has no sortable
  // headers of its own to preserve — a query reorders by how well it hit.
  const moveTable = useTableState({
    rows: rankedMoves,
    filterDefs: moveFilterDefs,
    searchMap: moveSearchMap,
    rankBySearch: true,
    initialSort: { key: "queueOrder", dir: "asc" },
    initialFilters: { zone: openingZoneName(myZoneNames) },
    pageSize: 1000,
  });
  const requestTable = useTableState({
    rows: requests,
    filterDefs: requestFilterDefs,
    searchMap: requestSearchMap,
    rankBySearch: true,
    initialSort: { key: "createdAtMs", dir: "desc" },
    initialFilters: { zone: openingZoneName(myZoneNames) },
    pageSize: 1000,
  });
  const cavingTable = useTableState({
    rows: cavingRolls ?? [],
    filterDefs: cavingFilterDefs,
    searchMap: cavingSearchMap,
    rankBySearch: true,
    initialSort: { key: "createdAtMs", dir: "desc" },
    // "Needs attention" only ever matches an unresolved TROUBLE row — QUIET
    // and FIND are stamped resolved at creation — so this is what keeps a
    // hundred quiet 2-5s off the rail by default.
    initialFilters: { status: "Needs attention", zone: openingZoneName(myZoneNames) },
    pageSize: 1000,
  });

  // Auto-filed travel Moves are already solved and never need a GM — hidden
  // from the list by default so they don't pad the queue, but picking
  // "Travel" in the Kind dropdown always overrides the hide (the dropdown's
  // own count already reflects the real total, hide or no hide).
  const [hideTravel, setHideTravel] = useState(true);
  const movesShown = useMemo(() => {
    if (!hideTravel || moveTable.filters.kind === "Travel") return moveTable.visible;
    return moveTable.visible.filter((r) => !r.isTravel);
  }, [moveTable.visible, moveTable.filters.kind, hideTravel]);
  const hiddenTravelCount = moveTable.visible.length - movesShown.length;

  const rowsForLens = { moves: movesShown, requests: requestTable.visible, caving: cavingTable.visible };
  const visibleRows = rowsForLens[lens] ?? movesShown;
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

      const rows = { moves: movesShown, requests: requestTable.visible, caving: cavingTable.visible }[lens] ?? [];
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
  }, [lens, onLens, onSelect, movesShown, requestTable.visible, cavingTable.visible, clampedKbdIndex, coarse]);

  return (
    <aside className="desk-rail" ref={railRef}>
      <div className="segmented desk-rail-lens" role="group" aria-label="Queue lens">
        <button type="button" aria-pressed={lens === "moves" || !lens} onClick={() => onLens?.("moves")}>
          Moves ({movesShown.length})
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
          <RailFilters
            table={requestTable}
            filterDefs={requestFilterDefs}
            myZoneNames={myZoneNames}
            searchPlaceholder="name, @handle, reason, text:…"
          />
          <div className="desk-queue">
            <RequestRows
              rows={requestTable.visible}
              matchFor={requestTable.matchFor}
              selected={selected}
              onSelect={onSelect}
              kbdId={kbdId}
              kbdLens={lens}
            />
            {requestTable.total === 0 && <p className="p-3 text-sm text-muted">No Requests match.</p>}
          </div>
        </>
      ) : lens === "caving" ? (
        <>
          <RailFilters
            table={cavingTable}
            filterDefs={cavingFilterDefs}
            myZoneNames={myZoneNames}
            searchPlaceholder="name, @handle, tag:…"
          />
          <div className="desk-queue">
            <CavingRows
              rows={cavingTable.visible}
              matchFor={cavingTable.matchFor}
              selected={selected}
              onSelect={onSelect}
              kbdId={kbdId}
              kbdLens={lens}
            />
            {cavingTable.total === 0 && <p className="p-3 text-sm text-muted">No Caving rolls match.</p>}
          </div>
        </>
      ) : (
        <>
          <RailFilters
            table={moveTable}
            filterDefs={moveFilterDefs}
            myZoneNames={myZoneNames}
            searchPlaceholder="name, role, @handle, zone:…"
          >
            {hiddenTravelCount > 0 && (
              <label className="field-label flex items-center gap-1.5" style={{ fontWeight: "normal" }}>
                <input type="checkbox" checked={!hideTravel} onChange={(e) => setHideTravel(!e.target.checked)} />
                Show {hiddenTravelCount} travel
              </label>
            )}
          </RailFilters>
          <div className="desk-queue">
            <MoveRows
              rows={movesShown}
              matchFor={moveTable.matchFor}
              stagedByMove={stagedByMove}
              selected={selected}
              onSelect={onSelect}
              gmProfiles={gmProfiles}
              kbdId={kbdId}
              kbdLens={lens}
            />
            {movesShown.length === 0 &&
              (hiddenTravelCount > 0 ? (
                <p className="p-3 text-sm text-muted">
                  No Moves match — {hiddenTravelCount} travel Move{hiddenTravelCount === 1 ? "" : "s"} hidden.
                </p>
              ) : (
                <p className="p-3 text-sm text-muted">No Moves match.</p>
              ))}
          </div>
        </>
      )}
      <p className="desk-rail-hint text-xs text-muted">↑↓ / j k navigate · ⏎ open · m/r/c lens · esc close</p>
    </aside>
  );
}
