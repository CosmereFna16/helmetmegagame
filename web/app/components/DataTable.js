"use client";

import { useCallback, useDeferredValue, useMemo, useState } from "react";
import Select from "./Select";
import { scoreMatch } from "@/lib/fuzzySearch";

// The shared filter/search/sort/paginate engine behind every list surface in
// the app — the adjudication tables, the player roster, the DM conversation
// list, the notes board.
//
// This started as gm/turns/tableUtils.js, serving those two tables alone,
// while /gm/players, /gm/messages and /notes each hand-rolled the same
// filter-select + useMemo pass slightly differently and none of them capped
// their height. Pagination is the one thing that wasn't here: /gm/turns
// rendered up to 500 rows into a 70vh box, which is what made it feel janky
// next to /gm/audit.
//
// Posture is client-side throughout: these pages already hold their whole set
// in memory, so filtering and paging are a plain pass rather than a round
// trip. /gm/audit is the deliberate exception — it pages server-side over the
// URL, and shares only the <Pager> below.

const DEFAULT_PAGE_SIZE = 50;

// `initialFilters` seeds the filter state once at mount, exactly as
// `initialSort` already does — which is the whole reason it is an *initial*
// value and not a synced prop. The GM tables use it to open on the viewer's
// own zone; making it re-apply on prop change would drag a GM who chose "All"
// back to their own zone on every revalidatePath, i.e. after every
// adjudication.
//
// `searchMap`, when given, replaces the naive per-field substring pass with
// the shared fuzzy engine (web/lib/fuzzySearch.js): diacritic folding,
// typo tolerance, and field:term / @term scopes. It's a function
// `(row) => ({ name, role, faction, username, zone, tag, status, kind,
// text, notes, preview })` — any subset. `searchFields` stays the plain
// substring fallback for surfaces that don't opt in (NotesList, TagCatalog,
// DepotCounter). `rankBySearch` additionally reorders by match score while
// a query is active — for a list with no sortable headers of its own
// (the /gm/turns queue rail); leave it off to keep the viewer's chosen
// column sort and use search purely as a filter (RosterTable).
export function useTableState({
  rows,
  searchFields,
  searchMap,
  filterDefs,
  initialSort,
  initialFilters,
  pageSize = DEFAULT_PAGE_SIZE,
  rankBySearch = false,
}) {
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState(initialFilters ?? {});
  const [sort, setSort] = useState(initialSort ?? { key: null, dir: "desc" });
  const [page, setPage] = useState(1);

  // The input echoes each keystroke immediately; the filter pass over the
  // full row set trails behind at deferred priority, so typing fast into a
  // 500-row table never stutters the caret.
  const deferredQuery = useDeferredValue(query);
  const trimmedQuery = deferredQuery.trim();

  const passesSearch = useCallback(
    (row) => {
      if (!trimmedQuery) return { ok: true, match: null };
      if (searchMap) {
        const match = scoreMatch(trimmedQuery, searchMap(row));
        return { ok: Boolean(match), match };
      }
      const q = trimmedQuery.toLowerCase();
      return { ok: searchFields.some((f) => String(f(row) ?? "").toLowerCase().includes(q)), match: null };
    },
    [trimmedQuery, searchMap, searchFields],
  );

  const passesOtherFilters = useCallback(
    (row, skipKey) => {
      for (const def of filterDefs) {
        if (def.key === skipKey) continue;
        const active = filters[def.key];
        if (active && String(def.value(row)) !== active) return false;
      }
      return true;
    },
    [filterDefs, filters],
  );

  // Each dropdown's option list, plus a count for every option — measured
  // against the rows that survive every OTHER active filter and the current
  // search, so the number on "Open (0)" describes exactly what clicking it
  // would give you. `def.options`, when a filter def supplies one, is a
  // fixed vocabulary (every enum value, not just ones on screen) rather than
  // one derived from the loaded rows — so "Open" doesn't vanish from the
  // list just because nothing is open right now.
  const options = useMemo(() => {
    const out = {};
    for (const def of filterDefs) {
      const values = def.options ?? [...new Set(rows.map(def.value).filter((v) => v !== "" && v != null))].sort();
      const counts = {};
      for (const row of rows) {
        if (!passesOtherFilters(row, def.key)) continue;
        if (!passesSearch(row).ok) continue;
        const v = String(def.value(row));
        counts[v] = (counts[v] ?? 0) + 1;
      }
      out[def.key] = values.map((value) => ({ value, count: counts[value] ?? 0 }));
    }
    return out;
  }, [rows, filterDefs, passesOtherFilters, passesSearch]);

  const { visible, matchByRow } = useMemo(() => {
    const filtered = [];
    const matches = new Map();
    for (const row of rows) {
      if (!passesOtherFilters(row, null)) continue;
      const { ok, match } = passesSearch(row);
      if (!ok) continue;
      if (match) matches.set(row, match);
      filtered.push(row);
    }

    const rankingBySearch = rankBySearch && trimmedQuery && searchMap;
    if (rankingBySearch) {
      return {
        visible: [...filtered].sort((a, b) => (matches.get(b)?.score ?? 0) - (matches.get(a)?.score ?? 0)),
        matchByRow: matches,
      };
    }
    if (!sort.key) return { visible: filtered, matchByRow: matches };
    const dir = sort.dir === "asc" ? 1 : -1;
    // Sort a copy — filtered may be the same array identity as rows when
    // nothing is filtered out, and sorting in place would mutate props.
    const sorted = [...filtered].sort((a, b) => {
      const av = a[sort.key];
      const bv = b[sort.key];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
      return String(av).localeCompare(String(bv)) * dir;
    });
    return { visible: sorted, matchByRow: matches };
  }, [rows, sort, rankBySearch, trimmedQuery, searchMap, passesOtherFilters, passesSearch]);

  const total = visible.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  // Narrowing the set has to send you back to page 1, or a filter applied
  // from page 7 strands you on an empty view. That reset rides on the
  // setters rather than an effect, so it happens in the same render as the
  // change that caused it instead of a cascading second one.
  const changeQuery = useCallback((v) => {
    setQuery(v);
    setPage(1);
  }, []);
  const changeFilters = useCallback((v) => {
    setFilters(v);
    setPage(1);
  }, []);
  const changeSort = useCallback((v) => {
    setSort(v);
    setPage(1);
  }, []);
  const toggleSort = useCallback((key) => {
    setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" }));
    setPage(1);
  }, []);

  // Clamped rather than stored, which also covers the row deleted out from
  // under you on the last page.
  const safePage = Math.min(Math.max(1, page), totalPages);
  const pageRows = useMemo(
    () => visible.slice((safePage - 1) * pageSize, safePage * pageSize),
    [visible, safePage, pageSize],
  );

  // The match-reason subtext (e.g. "· role") for a row scoreMatch picked —
  // only meaningful when searchMap is in play and a query is active.
  const matchFor = useCallback((row) => matchByRow.get(row) ?? null, [matchByRow]);

  return {
    query,
    setQuery: changeQuery,
    filters,
    setFilters: changeFilters,
    sort,
    setSort: changeSort,
    toggleSort,
    options,
    matchFor,
    visible,
    pageRows,
    page: safePage,
    setPage,
    total,
    totalPages,
  };
}

export function SortHeader({ label, sortKey, sort, onSort, style }) {
  const active = sort.key === sortKey;
  return (
    <th scope="col" style={style}>
      <button type="button" className="th-sort" onClick={() => onSort(sortKey)}>
        {label}
        <span aria-hidden="true" style={{ opacity: active ? 1 : 0.25 }}>
          {active && sort.dir === "asc" ? "▲" : "▼"}
        </span>
      </button>
    </th>
  );
}

// `sortOptions` is for the surfaces with no header row to hang a SortHeader
// off — /notes is a card list, so its newest/oldest control lives here
// instead. Tables leave it undefined and sort from their headers.
export function FilterBar({
  filterDefs,
  filters,
  setFilters,
  options,
  query,
  setQuery,
  searchLabel,
  searchPlaceholder,
  sortOptions,
  sort,
  setSort,
  children,
}) {
  return (
    <div className="flex flex-wrap items-end gap-3">
      {/* Grows to fill the row on a wide screen and shrinks below its 12rem
          preference on a narrow one — a hard min-width here stacked the whole
          filter row into five lines of chrome above the table at 375px. */}
      <label className="field min-w-0" style={{ flex: "1 1 12rem" }}>
        <span className="field-label">{searchLabel ?? "Search"}</span>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={searchPlaceholder ?? "Name, text…"}
        />
      </label>
      {filterDefs.map((def) => (
        <label className="field" key={def.key}>
          <span className="field-label">{def.label}</span>
          <Select
            value={filters[def.key] ?? ""}
            onChange={(e) => setFilters((f) => ({ ...f, [def.key]: e.target.value }))}
          >
            <option value="">All</option>
            {options[def.key]?.map((o) => (
              <option key={o.value} value={o.value}>
                {o.value} ({o.count})
              </option>
            ))}
          </Select>
        </label>
      ))}
      {sortOptions && (
        <label className="field">
          <span className="field-label">Sort</span>
          <Select
            value={`${sort.key}:${sort.dir}`}
            onChange={(e) => {
              const [key, dir] = e.target.value.split(":");
              setSort({ key, dir });
            }}
          >
            {sortOptions.map((o) => (
              <option key={`${o.key}:${o.dir}`} value={`${o.key}:${o.dir}`}>
                {o.label}
              </option>
            ))}
          </Select>
        </label>
      )}
      {children}
    </div>
  );
}

// The fixed-height, pinned-header, internally-scrolling frame every long
// table sits in. `minWidth` keeps wide tables scrolling sideways inside the
// container rather than pushing the page body sideways.
export function TableScroll({ minWidth, children }) {
  return (
    <div className="panel table-scroll">
      <table className="data-table" style={minWidth ? { minWidth } : undefined}>
        {children}
      </table>
    </div>
  );
}
