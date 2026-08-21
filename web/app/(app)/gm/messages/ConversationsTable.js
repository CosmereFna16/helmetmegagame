"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useTableState, SortHeader, FilterBar, TableScroll } from "@/app/components/DataTable";
import Pager from "@/app/components/Pager";

const COL_COUNT = 3;

// Nothing to filter down to here — a conversation has no zone or faction of
// its own — so the bar carries search alone.
const FILTER_DEFS = [];

const SEARCH_FIELDS = [(r) => r.name, (r) => r.preview];

export default function ConversationsTable({ conversations }) {
  const filterDefs = useMemo(() => FILTER_DEFS, []);
  const searchFields = useMemo(() => SEARCH_FIELDS, []);
  const { query, setQuery, filters, setFilters, sort, toggleSort, options, pageRows, page, setPage, total, totalPages } =
    useTableState({
      rows: conversations,
      filterDefs,
      searchFields,
      initialSort: { key: "lastAtMs", dir: "desc" },
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
        searchLabel="Search conversations"
      />

      <TableScroll>
        <thead>
          <tr>
            <SortHeader label="Player" sortKey="name" sort={sort} onSort={toggleSort} />
            <SortHeader label="Last message" sortKey="lastAtMs" sort={sort} onSort={toggleSort} />
            <SortHeader label="Messages" sortKey="count" sort={sort} onSort={toggleSort} />
          </tr>
        </thead>
        <tbody>
          {pageRows.map((row) => (
            <tr key={row.discordUserId}>
              <td className="whitespace-nowrap">
                <Link href={`/gm/messages/${row.discordUserId}`} className="menu-item">
                  {row.name}
                </Link>
              </td>
              <td className="max-w-md truncate">{row.preview}</td>
              <td>
                <Link href={`/gm/messages/${row.discordUserId}`} className="menu-item">
                  Open ({row.count})
                </Link>
              </td>
            </tr>
          ))}
          {pageRows.length === 0 && (
            <tr>
              <td colSpan={COL_COUNT} className="text-center text-muted">
                No direct messages yet.
              </td>
            </tr>
          )}
        </tbody>
      </TableScroll>

      <Pager page={page} totalPages={totalPages} total={total} unit="conversations" onPage={setPage} />
    </div>
  );
}
