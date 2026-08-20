"use client";

import { Fragment, useMemo, useState } from "react";
import { useTableState, SortHeader, FilterBar } from "./tableUtils";
import MessageCell, { MessageComposerRow } from "./MessageRow";

const COL_COUNT = 9;

// Open is deliberately plain body text, not a colour — it's the default
// state of every Move and colouring it would make the whole table shout.
const STATUS_COLORS = {
  Open: "var(--text)",
  "Waiting for Opponents": "var(--warning)",
  "In Progress": "var(--warning)",
  Solved: "var(--positive)",
};

const FILTER_DEFS = [
  { key: "turn", label: "Turn", value: (r) => r.turnLabel },
  { key: "faction", label: "Faction", value: (r) => r.factionName },
  { key: "kind", label: "Kind", value: (r) => r.kindLabel },
  { key: "opposed", label: "Opposed", value: (r) => (r.opposed ? "Yes" : "No") },
  { key: "status", label: "Status", value: (r) => r.statusLabel },
];

const SEARCH_FIELDS = [(r) => r.characterName, (r) => r.discordUsername, (r) => r.description, (r) => r.gmNotes];

export default function MovesTable({ moves, onAdjudicate }) {
  const [messagingId, setMessagingId] = useState(null);
  const filterDefs = useMemo(() => FILTER_DEFS, []);
  const searchFields = useMemo(() => SEARCH_FIELDS, []);
  const { query, setQuery, filters, setFilters, sort, toggleSort, options, visible } = useTableState({
    rows: moves,
    filterDefs,
    searchFields,
    initialSort: { key: "turnNumber", dir: "desc" },
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
        searchLabel="Search moves"
      />

      <div className="panel table-scroll">
        <table className="data-table" style={{ minWidth: "1100px" }}>
          <thead>
            <tr>
              <th scope="col" style={{ width: "1%" }}>
                <span className="sr-only">Adjudicate</span>
              </th>
              <th scope="col" style={{ width: "1%" }}>
                <span className="sr-only">Message</span>
              </th>
              <SortHeader label="Turn" sortKey="turnNumber" sort={sort} onSort={toggleSort} />
              <SortHeader label="Character" sortKey="characterName" sort={sort} onSort={toggleSort} />
              <SortHeader label="Discord" sortKey="discordUsername" sort={sort} onSort={toggleSort} />
              <SortHeader label="Faction" sortKey="factionName" sort={sort} onSort={toggleSort} />
              <th scope="col" style={{ minWidth: "22rem" }}>
                Move
              </th>
              <SortHeader label="Status" sortKey="statusLabel" sort={sort} onSort={toggleSort} />
              <th scope="col" style={{ minWidth: "12rem" }}>
                GM Notes
              </th>
            </tr>
          </thead>
          <tbody>
            {visible.map((row) => (
              <Fragment key={row.id}>
                <tr>
                  <td>
                    <button
                      type="button"
                      className="icon-btn"
                      title="Adjudicate this Move"
                      aria-label="Adjudicate this Move"
                      onClick={() => onAdjudicate?.(row)}
                    >
                      ⚖
                    </button>
                  </td>
                  <MessageCell
                    characterId={row.characterId}
                    open={messagingId === row.characterId}
                    onToggle={setMessagingId}
                  />
                  <td className="whitespace-nowrap">{row.turnLabel}</td>
                  <td className="whitespace-nowrap">{row.characterName}</td>
                  <td className="whitespace-nowrap" style={{ color: "var(--muted)" }}>
                    {row.discordUsername}
                  </td>
                  <td className="whitespace-nowrap">{row.factionName || "—"}</td>
                  <td>
                    <span className="block">{row.description}</span>
                    <span className="mt-1 block text-xs" style={{ color: "var(--muted)" }}>
                      {row.kindLabel}
                      {row.opposed ? " · Opposed" : ""}
                      {row.rollLabel ? ` · ${row.rollLabel}` : ""}
                    </span>
                  </td>
                  <td
                    className="whitespace-nowrap"
                    style={{ color: STATUS_COLORS[row.statusLabel] ?? "var(--text)" }}
                  >
                    {row.statusLabel}
                  </td>
                  <td style={{ color: "var(--muted)" }}>{row.gmNotes || "—"}</td>
                </tr>
                {messagingId === row.characterId && (
                  <MessageComposerRow
                    characterId={row.characterId}
                    characterName={row.characterName}
                    colSpan={COL_COUNT}
                    onDone={() => setMessagingId(null)}
                  />
                )}
              </Fragment>
            ))}
            {visible.length === 0 && (
              <tr>
                <td colSpan={COL_COUNT} className="text-center" style={{ color: "var(--muted)" }}>
                  No Moves match these filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
