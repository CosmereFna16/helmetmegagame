"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import StatusPill from "@/app/components/StatusPill";
import ZoneScopeToggle from "@/app/components/ZoneScopeToggle";
import Select from "@/app/components/Select";
import { openingZoneName } from "@/lib/zones";
import GmAvatar from "@/app/components/GmAvatar";
import CharacterAvatar from "@/app/components/CharacterAvatar";
import { useTableState } from "@/app/components/DataTable";
import useSessionState, { readSession, writeSession } from "@/app/components/useSessionState";
import { useIsCoarsePointer } from "@/app/components/useIsCoarsePointer";
import { isFieldFocused, hasModifier } from "@/lib/deskKeyGuard";
import { MOVE_REVIEW_TONES, MOVE_REVIEW_LABELS } from "@/lib/moves";
import { REQUEST_TYPE_LABELS, REQUEST_STATUS_LABELS } from "@/lib/requestLabels";
import { dialogHoldsKeyboard } from "@/app/components/Modal";

// The left rail: the work queue as a compact list, using useTableState (the
// same filter/search/sort engine every table uses) minus the table markup.

// Fixed vocabularies for the enum-backed dropdowns, so a value always shows
// even at a count of zero. WAITING_FOR_OPPONENTS/IN_PROGRESS are dropped —
// neither is a status the mapper produces (moveRows.js#moveStatusLabel).
const MOVE_KIND_OPTIONS = ["Routine", "Gambit", "Travel"];
const MOVE_STATUS_OPTIONS = Object.values(MOVE_REVIEW_LABELS).filter(
  (l) => l !== "Waiting for Opponents" && l !== "In Progress",
);

// Open work floats to the top; Solved/Passed sink. Ties fall back to
// recency — see queueOrder below.
const MOVE_STATUS_RANK = { Open: 0, "Waiting for Opponents": 0, Solved: 1, Passed: 2 };
// Same trick for the Caving lens — see rankedMoves below.
const CAVING_STATUS_RANK = { "Needs attention": 0, Resolved: 1 };
const REQUEST_TYPE_OPTIONS = [...new Set(Object.values(REQUEST_TYPE_LABELS))];
const REQUEST_STATUS_OPTIONS = Object.values(REQUEST_STATUS_LABELS);
const REVIEWED_OPTIONS = ["Reviewed", "Unreviewed"];
const CAVING_STATUS_OPTIONS = ["Needs attention", "Resolved"];

const MOVE_FILTER_DEFS = [
  { key: "zone", label: "Zone", value: (r) => r.factionZoneName },
  { key: "kind", label: "Kind", value: (r) => r.kindLabel, options: MOVE_KIND_OPTIONS },
  { key: "status", label: "Status", value: (r) => r.statusLabel, options: MOVE_STATUS_OPTIONS },
];
// scoreMatch fields (web/lib/fuzzySearch.js). `tags` only carries tagIds, so
// tag name search needs the catalog lookup, hence the factory.
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

// One sessionStorage key for the CLICK-frequency rail VIEW state — a reload
// restores it. Workspace.js reads the same key for `lens`.
export const RAIL_STORAGE_KEY = "gm-turns-rail";
export const RAIL_STORAGE_DEFAULT = {
  lens: "moves",
  filters: {}, // { moves, requests, caving, history, "history-caving" } — each an initialFilters-shaped object
  hideTravel: true,
  hideHistoryTravel: true,
  historyKind: "moves", // "moves" | "caving"
};

// KEYSTROKE/SCROLL-frequency state lives under a key nothing subscribes to
// (useSessionState.js#readSession/#writeSession), so writing it can't wake
// this component. Debounced, with a pagehide flush for the tail.
const VIEW_STORAGE_KEY = "gm-turns-view";
const VIEW_STORAGE_DEFAULT = { query: {}, scroll: {} };

// Read-merge-write so the query writer and the scroll writer never clobber
// each other's half of the key.
function mergeView(patch) {
  const current = readSession(VIEW_STORAGE_KEY, VIEW_STORAGE_DEFAULT) ?? VIEW_STORAGE_DEFAULT;
  writeSession(VIEW_STORAGE_KEY, {
    ...current,
    ...(patch.query ? { query: { ...current.query, ...patch.query } } : null),
    ...(patch.scroll ? { scroll: { ...current.scroll, ...patch.scroll } } : null),
  });
}

// Hydration signal: false on the server and during the hydration render
// (where storage-derived state would mismatch server HTML), true after.
const subscribeNever = () => () => {};
const getTrue = () => true;
const getFalse = () => false;

// The Caving lens — see docs/systemdocs/CAVING.md. Only a TROUBLE row is
// ever "Needs attention"; every roll shows by default, unresolved TROUBLE
// just ranks first.
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

// The keyboard lens flips, and what ⏎ selects in each lens. The History
// lens over the OPEN turn selects a live "move" — see historyIsOpenTurn.
const LENS_FOR_KEY = { m: "moves", r: "requests", c: "caving", h: "history" };
const SELECTION_TYPE_FOR_LENS = {
  moves: "move",
  requests: "request",
  caving: "caving",
  history: "history",
};

// The match-reason subtext — only worth showing when the hit came off a
// field other than the name everyone can already see on the row.
function MatchHint({ match }) {
  if (!match || match.matchedField === "name") return null;
  return <span className="text-xs text-muted"> · {match.matchedField}</span>;
}

function RailFilters({ table, filterDefs, myZoneNames, searchPlaceholder, header, children }) {
  return (
    <div className="desk-rail-filters">
      {header}
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

// `type` and `lensKey` are what let the History lens reuse this: identical
// rows, a different selection type and keyboard lens.
function MoveRows({
  rows,
  matchFor,
  stagedByMove,
  selected,
  onSelect,
  gmProfiles,
  kbdId,
  kbdLens,
  type = "move",
  lensKey = "moves",
}) {
  return rows.map((row) => {
    const staged = stagedByMove.get(row.id);
    const stagedCount = (staged?.effects.length ?? 0) + (staged?.messages.length ?? 0);
    const active = selected?.type === type && selected.id === row.id;
    return (
      <button
        key={row.id}
        type="button"
        className="desk-queue-row"
        data-active={active}
        data-auto={row.isTravel || undefined}
        data-kbd={kbdLens === lensKey && kbdId === row.id ? "" : undefined}
        data-row-key={row.id}
        onClick={() => onSelect({ type, id: row.id })}
      >
        <span className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-1.5 truncate font-medium">
            <CharacterAvatar characterId={row.characterId} name={row.characterName} version={row.avatarVersion} catatonic={row.catatonic} />
            <span className="truncate">{row.characterName}</span>
            <MatchHint match={matchFor(row)} />
          </span>
          <span className="flex items-center gap-1.5">
            {row.lockedByDiscordUserId && <GmAvatar profile={gmProfiles?.[row.lockedByDiscordUserId]} size={14} />}
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
    // Both request types that can name a kill; an unkilled row here is the
    // exception, worth the urgent mark. See killRequestTargetImpl in actions.js.
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
            <CharacterAvatar characterId={row.characterId} name={row.characterName} version={row.avatarVersion} catatonic={row.catatonic} />
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

function CavingRows({ rows, matchFor, selected, onSelect, kbdId, kbdLens, lensKey = "caving" }) {
  return rows.map((row) => {
    const active = selected?.type === "caving" && selected.id === row.id;
    return (
      <button
        key={row.id}
        type="button"
        className="desk-queue-row"
        data-active={active}
        data-urgent={row.statusLabel === "Needs attention" || undefined}
        data-kbd={kbdLens === lensKey && kbdId === row.id ? "" : undefined}
        data-row-key={row.id}
        onClick={() => onSelect({ type: "caving", id: row.id })}
      >
        <span className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-1.5 truncate font-medium">
            <CharacterAvatar characterId={row.characterId} name={row.characterName} version={row.avatarVersion} catatonic={row.catatonic} />
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
  historyTurnOptions,
  historyIsOpenTurn,
  historyTurnId,
  onHistoryTurn,
  historyMoves,
  historyStagedByMove,
  historyKind,
  onHistoryKind,
  historyCavingRolls,
  historyLoading,
  historyError,
}) {
  const moveFilterDefs = useMemo(() => MOVE_FILTER_DEFS, []);
  const requestFilterDefs = useMemo(() => REQUEST_FILTER_DEFS, []);
  const cavingFilterDefs = useMemo(() => CAVING_FILTER_DEFS, []);
  const moveSearchMap = useMemo(() => makeMoveSearchMap(tagsById), [tagsById]);

  // The rail's persisted view state. Each table's filters live under their
  // own sub-key via useTableState's controlled mode (DataTable.js).
  const [rail, setRail] = useSessionState(RAIL_STORAGE_KEY, RAIL_STORAGE_DEFAULT);
  const makeFiltersProps = useCallback(
    (key) => ({
      filters: rail.filters[key] ?? { zone: openingZoneName(myZoneNames) },
      onFiltersChange: (next) => setRail((r) => ({ ...r, filters: { ...r.filters, [key]: next } })),
    }),
    [rail.filters, myZoneNames, setRail],
  );

  // One numeric key so the generic engine's one-field sort ranks by status
  // first, recency second (status multiplied out of recency's range).
  const rankedMoves = useMemo(
    () =>
      moves.map((r) => ({
        ...r,
        queueOrder: (MOVE_STATUS_RANK[r.statusLabel] ?? 0) * 1e15 - r.createdAtMs,
      })),
    [moves],
  );

  const rankedHistoryMoves = useMemo(
    () =>
      (historyMoves ?? []).map((r) => ({
        ...r,
        queueOrder: (MOVE_STATUS_RANK[r.statusLabel] ?? 0) * 1e15 - r.createdAtMs,
      })),
    [historyMoves],
  );

  const rankedCavingRolls = useMemo(
    () =>
      (cavingRolls ?? []).map((r) => ({
        ...r,
        queueOrder: (CAVING_STATUS_RANK[r.statusLabel] ?? 0) * 1e15 - r.createdAtMs,
      })),
    [cavingRolls],
  );

  // All four tables mount permanently so lens flips keep each one's filters.
  // rankBySearch: true — no sortable headers to preserve, a query reorders.
  const moveTable = useTableState({
    rows: rankedMoves,
    filterDefs: moveFilterDefs,
    searchMap: moveSearchMap,
    rankBySearch: true,
    initialSort: { key: "queueOrder", dir: "asc" },
    pageSize: 1000,
    ...makeFiltersProps("moves"),
  });
  const requestTable = useTableState({
    rows: requests,
    filterDefs: requestFilterDefs,
    searchMap: requestSearchMap,
    rankBySearch: true,
    initialSort: { key: "createdAtMs", dir: "desc" },
    pageSize: 1000,
    ...makeFiltersProps("requests"),
  });
  const cavingTable = useTableState({
    rows: rankedCavingRolls,
    filterDefs: cavingFilterDefs,
    searchMap: cavingSearchMap,
    rankBySearch: true,
    initialSort: { key: "queueOrder", dir: "asc" },
    pageSize: 1000,
    ...makeFiltersProps("caving"),
  });
  // The History lens is the Moves lens over a past turn.
  const historyTable = useTableState({
    rows: rankedHistoryMoves,
    filterDefs: moveFilterDefs,
    searchMap: moveSearchMap,
    rankBySearch: true,
    initialSort: { key: "queueOrder", dir: "asc" },
    pageSize: 1000,
    ...makeFiltersProps("history"),
  });
  // The History lens's Caving twin, with its own filter/search/scroll state.
  const rankedHistoryCavingRolls = useMemo(
    () =>
      (historyCavingRolls ?? []).map((r) => ({
        ...r,
        queueOrder: (CAVING_STATUS_RANK[r.statusLabel] ?? 0) * 1e15 - r.createdAtMs,
      })),
    [historyCavingRolls],
  );
  const historyCavingTable = useTableState({
    rows: rankedHistoryCavingRolls,
    filterDefs: cavingFilterDefs,
    searchMap: cavingSearchMap,
    rankBySearch: true,
    initialSort: { key: "queueOrder", dir: "asc" },
    pageSize: 1000,
    ...makeFiltersProps("history-caving"),
  });

  // Restores persisted search text once, on the first post-hydration render
  // — a render-time one-shot (react-hooks/set-state-in-effect is an error
  // here), never during hydration itself.
  const hydrated = useSyncExternalStore(subscribeNever, getTrue, getFalse);
  const [viewRestored, setViewRestored] = useState(false);
  if (hydrated && !viewRestored) {
    setViewRestored(true);
    const storedQuery = readSession(VIEW_STORAGE_KEY, VIEW_STORAGE_DEFAULT).query ?? {};
    if (storedQuery.moves) moveTable.setQuery(storedQuery.moves);
    if (storedQuery.requests) requestTable.setQuery(storedQuery.requests);
    if (storedQuery.caving) cavingTable.setQuery(storedQuery.caving);
    if (storedQuery.history) historyTable.setQuery(storedQuery.history);
    if (storedQuery["history-caving"]) historyCavingTable.setQuery(storedQuery["history-caving"]);
  }

  // Mirror search text back out, debounced with a pagehide flush. Gated on
  // viewRestored so the first render can't overwrite stored queries.
  useEffect(() => {
    if (!viewRestored) return undefined;
    const write = () =>
      mergeView({
        query: {
          moves: moveTable.query,
          requests: requestTable.query,
          caving: cavingTable.query,
          history: historyTable.query,
          "history-caving": historyCavingTable.query,
        },
      });
    const id = setTimeout(write, 400);
    window.addEventListener("pagehide", write);
    return () => {
      clearTimeout(id);
      window.removeEventListener("pagehide", write);
    };
  }, [
    viewRestored,
    moveTable.query,
    requestTable.query,
    cavingTable.query,
    historyTable.query,
    historyCavingTable.query,
  ]);

  // Auto-filed travel Moves are already solved and hidden by default;
  // picking "Travel" in the Kind dropdown overrides the hide.
  const hideTravel = rail.hideTravel ?? true;
  const setHideTravel = useCallback((v) => setRail((r) => ({ ...r, hideTravel: v })), [setRail]);
  const movesShown = useMemo(() => {
    if (!hideTravel || moveTable.filters.kind === "Travel") return moveTable.visible;
    return moveTable.visible.filter((r) => !r.isTravel);
  }, [moveTable.visible, moveTable.filters.kind, hideTravel]);
  const hiddenTravelCount = moveTable.visible.length - movesShown.length;

  const hideHistoryTravel = rail.hideHistoryTravel ?? true;
  const setHideHistoryTravel = useCallback((v) => setRail((r) => ({ ...r, hideHistoryTravel: v })), [setRail]);
  const historyShown = useMemo(() => {
    if (!hideHistoryTravel || historyTable.filters.kind === "Travel") return historyTable.visible;
    return historyTable.visible.filter((r) => !r.isTravel);
  }, [historyTable.visible, historyTable.filters.kind, hideHistoryTravel]);
  const hiddenHistoryTravelCount = historyTable.visible.length - historyShown.length;

  // The History lens reads either past Moves or past Caving rolls, chosen
  // by its header switch (historyKind). Everything below branches on it.
  const historyIsCaving = lens === "history" && historyKind === "caving";
  const rowsForLens = useMemo(
    () => ({
      moves: movesShown,
      requests: requestTable.visible,
      caving: cavingTable.visible,
      history: historyIsCaving ? historyCavingTable.visible : historyShown,
    }),
    [movesShown, requestTable.visible, cavingTable.visible, historyIsCaving, historyCavingTable.visible, historyShown],
  );
  const visibleRows = rowsForLens[lens] ?? movesShown;
  const historySelectionType = historyIsCaving ? "caving" : historyIsOpenTurn ? "move" : "history";
  // Tracked by ROW ID, not position — a status change re-sorts the rail, and
  // an index-based cursor would follow the slot instead of the row.
  const [kbdCursorId, setKbdCursorId] = useState(null);
  const railRef = useRef(null);
  const coarse = useIsCoarsePointer();

  // Scroll position per lens, saved (debounced) into the view key, restored
  // once per lens activation. Restoring assigns scrollTop directly.
  const queueRef = useRef(null);
  const scrollWriteTimer = useRef(0);
  const pendingScroll = useRef(null); // { lens, top }
  // Flush-not-discard: a pending write for a DIFFERENT lens flushes instead
  // of being silently overwritten by a lens flip's scrollTop=0.
  const flushScroll = useCallback(() => {
    clearTimeout(scrollWriteTimer.current);
    const pending = pendingScroll.current;
    if (!pending) return;
    pendingScroll.current = null;
    mergeView({ scroll: { [pending.lens]: pending.top } });
  }, []);
  const onQueueScroll = useCallback(
    (e) => {
      const top = e.currentTarget.scrollTop;
      const key = lens ?? "moves";
      if (pendingScroll.current && pendingScroll.current.lens !== key) flushScroll();
      pendingScroll.current = { lens: key, top };
      clearTimeout(scrollWriteTimer.current);
      scrollWriteTimer.current = setTimeout(flushScroll, 200);
    },
    [lens, flushScroll],
  );
  // Same pagehide flush as the query mirror; unmount flushes too.
  useEffect(() => {
    window.addEventListener("pagehide", flushScroll);
    return () => {
      window.removeEventListener("pagehide", flushScroll);
      flushScroll();
    };
  }, [flushScroll]);

  const restoredScrollLens = useRef(null);
  useEffect(() => {
    if (!viewRestored) return;
    if (restoredScrollLens.current === lens) return;
    const el = queueRef.current;
    if (!el) return;
    const top = readSession(VIEW_STORAGE_KEY, VIEW_STORAGE_DEFAULT).scroll?.[lens ?? "moves"];
    if (typeof top === "number" && top > 0) {
      // History rows arrive async — hold off restoring against an empty list.
      if (visibleRows.length === 0) return;
      el.scrollTop = top;
    } else {
      // The scroller div is reused across lens flips, so a fresh lens must
      // be reset explicitly or it inherits the previous scroll offset.
      el.scrollTop = 0;
    }
    restoredScrollLens.current = lens;
  }, [viewRestored, lens, visibleRows.length]);

  const clampedKbdIndex = kbdCursorId ? visibleRows.findIndex((r) => r.id === kbdCursorId) : -1;
  const kbdId = clampedKbdIndex >= 0 ? visibleRows[clampedKbdIndex]?.id : null;

  useEffect(() => {
    if (coarse) return undefined;
    function onKey(e) {
      const key = e.key;
      const isNav = key === "ArrowDown" || key === "ArrowUp" || key === "j" || key === "k" || key === "Enter";
      const isLensKey = key === "m" || key === "r" || key === "c" || key === "h";
      if (!isNav && !isLensKey) return;
      if (hasModifier(e)) return;
      if (dialogHoldsKeyboard()) return;
      if (isFieldFocused(document.activeElement)) return;

      if (isLensKey) {
        onLens?.(LENS_FOR_KEY[key]);
        setKbdCursorId(null);
        return;
      }

      const rows = rowsForLens[lens] ?? [];
      if (!rows.length) return;

      if (key === "Enter") {
        const row = clampedKbdIndex >= 0 ? rows[clampedKbdIndex] : null;
        const type = lens === "history" ? historySelectionType : (SELECTION_TYPE_FOR_LENS[lens] ?? "move");
        if (row) onSelect({ type, id: row.id });
        return;
      }

      e.preventDefault();
      const delta = key === "ArrowDown" || key === "j" ? 1 : -1;
      const next = Math.max(0, Math.min(rows.length - 1, clampedKbdIndex + delta));
      setKbdCursorId(rows[next].id);
      railRef.current?.querySelector(`[data-row-key="${rows[next].id}"]`)?.scrollIntoView({ block: "nearest" });
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    lens,
    onLens,
    onSelect,
    rowsForLens,
    clampedKbdIndex,
    coarse,
    historySelectionType,
  ]);

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
        <button type="button" aria-pressed={lens === "history"} onClick={() => onLens?.("history")}>
          History
        </button>
      </div>

      {lens === "history" ? (
        <>
          <RailFilters
            table={historyIsCaving ? historyCavingTable : historyTable}
            filterDefs={historyIsCaving ? cavingFilterDefs : moveFilterDefs}
            myZoneNames={myZoneNames}
            searchPlaceholder={
              historyIsCaving ? "name, @handle, tag:…" : "name, role, @handle, zone:…"
            }
            header={
              <div className="flex flex-col gap-2">
                <div className="segmented" role="group" aria-label="History kind">
                  <button
                    type="button"
                    aria-pressed={historyKind !== "caving"}
                    onClick={() => onHistoryKind?.("moves")}
                  >
                    Moves
                  </button>
                  <button
                    type="button"
                    aria-pressed={historyKind === "caving"}
                    onClick={() => onHistoryKind?.("caving")}
                  >
                    Caving
                  </button>
                </div>
                <label className="field">
                  <span className="field-label">Turn</span>
                  <Select
                    value={historyTurnId ?? ""}
                    disabled={!historyTurnOptions?.length}
                    onChange={(e) => onHistoryTurn?.(e.target.value)}
                  >
                    {historyTurnOptions?.length ? (
                      historyTurnOptions.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.label}
                        </option>
                      ))
                    ) : (
                      <option value="">No turns yet</option>
                    )}
                  </Select>
                </label>
              </div>
            }
          >
            {!historyIsCaving && hiddenHistoryTravelCount > 0 && (
              <label className="field-label flex items-center gap-1.5" style={{ fontWeight: "normal" }}>
                <input
                  type="checkbox"
                  checked={!hideHistoryTravel}
                  onChange={(e) => setHideHistoryTravel(!e.target.checked)}
                />
                Show {hiddenHistoryTravelCount} travel
              </label>
            )}
          </RailFilters>
          <div className="desk-queue" ref={queueRef} onScroll={onQueueScroll}>
            {historyIsCaving ? (
              <>
                <CavingRows
                  rows={historyCavingTable.visible}
                  matchFor={historyCavingTable.matchFor}
                  selected={selected}
                  onSelect={onSelect}
                  kbdId={kbdId}
                  kbdLens={lens}
                  lensKey="history"
                />
                {historyError && <p className="p-3 text-sm form-error">{historyError}</p>}
                {!historyError && historyLoading && (
                  <p className="p-3 text-sm text-muted">Loading that turn…</p>
                )}
                {!historyError && !historyLoading && historyCavingTable.visible.length === 0 && (
                  <p className="p-3 text-sm text-muted">
                    {historyTurnOptions?.length
                      ? "No Caving rolls on that turn match."
                      : "No turn to read back yet."}
                  </p>
                )}
              </>
            ) : (
              <>
                <MoveRows
                  rows={historyShown}
                  matchFor={historyTable.matchFor}
                  stagedByMove={historyStagedByMove ?? new Map()}
                  selected={selected}
                  onSelect={onSelect}
                  gmProfiles={gmProfiles}
                  kbdId={kbdId}
                  kbdLens={lens}
                  // On the open turn a History row is still LIVE, so it opens
                  // the ordinary MoveDesk; MoveHistoryDesk never renders for
                  // an unpushed turn.
                  type={historyIsOpenTurn ? "move" : "history"}
                  lensKey="history"
                />
                {historyError && <p className="p-3 text-sm form-error">{historyError}</p>}
                {!historyError && historyLoading && (
                  <p className="p-3 text-sm text-muted">Loading that turn…</p>
                )}
                {!historyError && !historyLoading && historyShown.length === 0 && (
                  <p className="p-3 text-sm text-muted">
                    {historyTurnOptions?.length
                      ? hiddenHistoryTravelCount > 0
                        ? `No Moves match — ${hiddenHistoryTravelCount} travel Move${hiddenHistoryTravelCount === 1 ? "" : "s"} hidden.`
                        : "No Moves on that turn match."
                      : "No turn to read back yet."}
                  </p>
                )}
              </>
            )}
          </div>
        </>
      ) : lens === "requests" ? (
        <>
          <RailFilters
            table={requestTable}
            filterDefs={requestFilterDefs}
            myZoneNames={myZoneNames}
            searchPlaceholder="name, @handle, reason, text:…"
          />
          <div className="desk-queue" ref={queueRef} onScroll={onQueueScroll}>
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
          <div className="desk-queue" ref={queueRef} onScroll={onQueueScroll}>
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
          <div className="desk-queue" ref={queueRef} onScroll={onQueueScroll}>
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
      <p className="desk-rail-hint text-xs text-muted">↑↓ / j k navigate · ⏎ open · m/r/c/h lens · esc close</p>
    </aside>
  );
}
