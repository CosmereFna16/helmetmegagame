"use client";

import { useMemo, useState } from "react";
import { sendGmMessage } from "../actions";
import CharacterLink from "../../../components/CharacterLink";
import FactionLink from "../../../components/FactionLink";
import { useTableState, SortHeader, FilterBar, TableScroll } from "@/app/components/DataTable";
import Pager from "@/app/components/Pager";

const COL_COUNT = 8;

const FILTER_DEFS = [
  { key: "zone", label: "Zone", value: (c) => c.zoneName },
  { key: "faction", label: "Faction", value: (c) => c.factionName },
  { key: "status", label: "Status", value: (c) => c.status },
];

const SEARCH_FIELDS = [(c) => c.name, (c) => c.roleTitle, (c) => c.factionName];

export default function PlayersTable({ characters }) {
  // Keyed on character id rather than row index, so a selection survives
  // paging, filtering and sorting — the recipient list is what gets sent.
  const [selected, setSelected] = useState(new Set());
  const [composerOpen, setComposerOpen] = useState(false);

  const filterDefs = useMemo(() => FILTER_DEFS, []);
  const searchFields = useMemo(() => SEARCH_FIELDS, []);
  const { query, setQuery, filters, setFilters, sort, toggleSort, options, pageRows, page, setPage, total, totalPages } =
    useTableState({
      rows: characters,
      filterDefs,
      searchFields,
      initialSort: { key: "name", dir: "asc" },
    });

  function toggle(id) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <FilterBar
        filterDefs={filterDefs}
        filters={filters}
        setFilters={setFilters}
        options={options}
        query={query}
        setQuery={setQuery}
        searchLabel="Search players"
      >
        <button
          type="button"
          className="btn"
          disabled={selected.size === 0}
          onClick={() => setComposerOpen((open) => !open)}
        >
          Message selected ({selected.size})
        </button>
      </FilterBar>

      {composerOpen && selected.size > 0 && (
        <form
          action={sendGmMessage}
          className="panel flex flex-col gap-3 p-4"
          onSubmit={() => {
            setComposerOpen(false);
            setSelected(new Set());
          }}
        >
          {[...selected].map((id) => (
            <input key={id} type="hidden" name="characterId" value={id} />
          ))}
          <label className="field">
            <span className="field-label">Message ({selected.size} recipient{selected.size === 1 ? "" : "s"}, sent from Lifeweb)</span>
            <textarea name="message" rows={3} required />
          </label>
          <button type="submit" className="btn self-start">
            Send
          </button>
        </form>
      )}

      <TableScroll>
        <thead>
          <tr>
            <th scope="col" style={{ width: "1%" }}>
              <span className="sr-only">Select</span>
            </th>
            <SortHeader label="Name" sortKey="name" sort={sort} onSort={toggleSort} />
            <SortHeader label="Role" sortKey="roleTitle" sort={sort} onSort={toggleSort} />
            <SortHeader label="Faction" sortKey="factionName" sort={sort} onSort={toggleSort} />
            <SortHeader label="Zone" sortKey="zoneName" sort={sort} onSort={toggleSort} />
            <SortHeader label="Status" sortKey="status" sort={sort} onSort={toggleSort} />
            <th scope="col">Cursed</th>
            <SortHeader label="Resources" sortKey="resources" sort={sort} onSort={toggleSort} />
          </tr>
        </thead>
        <tbody>
          {pageRows.map((c) => (
            <tr key={c.id}>
              <td>
                <input
                  type="checkbox"
                  checked={selected.has(c.id)}
                  onChange={() => toggle(c.id)}
                  aria-label={`Select ${c.name}`}
                />
              </td>
              <td>
                <CharacterLink characterId={c.id} name={c.name} isGm />
              </td>
              <td>{c.roleTitle ?? "-"}</td>
              <td>
                <FactionLink factionId={c.factionId} name={c.factionName || "-"} />
              </td>
              <td>{c.zoneName || "-"}</td>
              <td>{c.status}</td>
              <td style={{ color: c.cursed ? "var(--accent)" : "var(--muted)" }}>
                {c.cursed ? "Cursed" : "-"}
              </td>
              <td className="mono">{c.resources} ⬢</td>
            </tr>
          ))}
          {pageRows.length === 0 && (
            <tr>
              <td colSpan={COL_COUNT} className="text-center text-muted">
                No characters match these filters.
              </td>
            </tr>
          )}
        </tbody>
      </TableScroll>

      <Pager page={page} totalPages={totalPages} total={total} unit="players" onPage={setPage} />
    </div>
  );
}
