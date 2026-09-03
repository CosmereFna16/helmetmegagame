"use client";

import { useCallback, useDeferredValue, useMemo, useState } from "react";
import Select from "./Select";
import { scoreMatch } from "@/lib/fuzzySearch";

// The shared filter/search/sort/paginate engine behind every list surface in
// the app. Client-side throughout — these pages already hold their whole set
// in memory. /gm/audit is the exception: it pages server-side over the URL,
// sharing only <Pager> below.

const DEFAULT_PAGE_SIZE = 50;

// `initialFilters` seeds state once at mount, not a synced prop, so a GM's
// "All" choice doesn't get dragged back to their zone on revalidatePath.
// `searchMap`, when given, replaces the substring pass with the fuzzy engine
// (web/lib/fuzzySearch.js). `rankBySearch` reorders by match score for a
// list with no sortable headers (the queue rail); leave off to keep the
// viewer's column sort. `filters` + `onFiltersChange`, given together, put
// filters in CONTROLLED mode (the caller owns the value); omit both for the
// internal `initialFilters`-seeded useState.
export function useTableState({
  rows,
  searchFields,
  searchMap,
  filterDefs,
  initialSort,
  initialFilters,
  filters: controlledFilters,
  onFiltersChange,
  pageSize = DEFAULT_PAGE_SIZE,
  rankBySearch = false,
}) {
  const [query, setQuery] = useState("");
  const [uncontrolledFilters, setUncontrolledFilters] = useState(initialFilters ?? {});
  const filters = controlledFilters ?? uncontrolledFilters;
  const [sort, setSort] = useState(initialSort ?? { key: null, dir: "desc" });
  const [page, setPage] = useState(1);

  // Filter pass trails at deferred priority so fast typing never stutters.
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

  // Each dropdown's options + counts, measured against rows surviving every
  // OTHER active filter and the current search. `def.options`, when given,
  // is a fixed vocabulary rather than one derived from loaded rows.
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
    // Sort a copy — filtered may share identity with rows, and sorting in
    // place would mutate props.
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

  // Reset to page 1 rides on the setters, not an effect, so it happens in
  // the same render as the change that caused it (react-hooks/set-state-in-effect).
  const changeQuery = useCallback((v) => {
    setQuery(v);
    setPage(1);
  }, []);
  // `v` may be a plain value or an updater function, resolved against
  // THIS render's `filters` before handing off to whichever store owns it.
  const changeFilters = useCallback(
    (v) => {
      const next = typeof v === "function" ? v(filters) : v;
      if (onFiltersChange) onFiltersChange(next);
      else setUncontrolledFilters(next);
      setPage(1);
    },
    [filters, onFiltersChange],
  );
  const changeSort = useCallback((v) => {
    setSort(v);
    setPage(1);
  }, []);
  const toggleSort = useCallback((key) => {
    setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" }));
    setPage(1);
  }, []);

  // Clamped rather than stored, covering a row deleted on the last page.
  const safePage = Math.min(Math.max(1, page), totalPages);
  const pageRows = useMemo(
    () => visible.slice((safePage - 1) * pageSize, safePage * pageSize),
    [visible, safePage, pageSize],
  );

  // Match-reason subtext for a row, only meaningful with searchMap + a query.
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

// `sortOptions` is for surfaces with no header row to hang a SortHeader off
// (/notes). Tables leave it undefined and sort from their headers.
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
      <label className="field min-w-0" style={{ flex: "1 1 12rem" }}>
        <span className="field-label">{searchLabel ?? "Search"}</span>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={searchPlaceholder ?? "Name, text…"}
        />
      </label>
      {/* def.minWidth (opt-in) keeps a dropdown readable when its resting
          value ("All") is much shorter than the names it offers. */}
      {filterDefs.map((def) => (
        <label className="field" key={def.key} style={def.minWidth ? { minWidth: def.minWidth } : undefined}>
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
// table sits in.
export function TableScroll({ minWidth, children }) {
  return (
    <div className="panel table-scroll">
      <table className="data-table" style={minWidth ? { minWidth } : undefined}>
        {children}
      </table>
    </div>
  );
}
