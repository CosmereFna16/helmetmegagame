"use client";

import { useMemo, useState } from "react";

// The shared filter/sort/search behaviour behind both adjudication tables.
// Same client-side posture as PlayersTable.js — the whole set is already in
// memory, so filtering is a plain pass rather than a round trip.

export function useTableState({ rows, searchFields, filterDefs, initialSort }) {
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState({});
  const [sort, setSort] = useState(initialSort ?? { key: null, dir: "desc" });

  const options = useMemo(() => {
    const out = {};
    for (const def of filterDefs) {
      out[def.key] = [...new Set(rows.map(def.value).filter((v) => v !== "" && v != null))].sort();
    }
    return out;
  }, [rows, filterDefs]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = rows.filter((row) => {
      for (const def of filterDefs) {
        const active = filters[def.key];
        if (active && String(def.value(row)) !== active) return false;
      }
      if (!q) return true;
      return searchFields.some((f) => String(f(row) ?? "").toLowerCase().includes(q));
    });

    if (!sort.key) return filtered;
    const dir = sort.dir === "asc" ? 1 : -1;
    // Sort a copy — filtered may be the same array identity as rows when
    // nothing is filtered out, and sorting in place would mutate props.
    return [...filtered].sort((a, b) => {
      const av = a[sort.key];
      const bv = b[sort.key];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
      return String(av).localeCompare(String(bv)) * dir;
    });
  }, [rows, query, filters, sort, filterDefs, searchFields]);

  function toggleSort(key) {
    setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" }));
  }

  return { query, setQuery, filters, setFilters, sort, toggleSort, options, visible };
}

export function SortHeader({ label, sortKey, sort, onSort }) {
  const active = sort.key === sortKey;
  return (
    <th scope="col">
      <button type="button" className="th-sort" onClick={() => onSort(sortKey)}>
        {label}
        <span aria-hidden="true" style={{ opacity: active ? 1 : 0.25 }}>
          {active && sort.dir === "asc" ? "▲" : "▼"}
        </span>
      </button>
    </th>
  );
}

export function FilterBar({ filterDefs, filters, setFilters, options, query, setQuery, searchLabel }) {
  return (
    <div className="flex flex-wrap items-end gap-3">
      <label className="field" style={{ minWidth: "12rem" }}>
        <span className="field-label">{searchLabel ?? "Search"}</span>
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Name, text…" />
      </label>
      {filterDefs.map((def) => (
        <label className="field" key={def.key}>
          <span className="field-label">{def.label}</span>
          <select
            value={filters[def.key] ?? ""}
            onChange={(e) => setFilters((f) => ({ ...f, [def.key]: e.target.value }))}
          >
            <option value="">All</option>
            {options[def.key]?.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        </label>
      ))}
    </div>
  );
}
