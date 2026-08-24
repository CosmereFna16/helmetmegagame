"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useTableState, SortHeader, FilterBar, TableScroll } from "@/app/components/DataTable";
import Pager from "@/app/components/Pager";
import ZoneChip from "@/app/components/ZoneChip";
import ZoneScopeToggle from "@/app/components/ZoneScopeToggle";

const COL_COUNT = 4;

// A conversation is keyed on a Discord user rather than a character, so it has
// no zone of its own — but the player behind it does, through their
// character's faction. That is resolved in page.js and flattened onto the row,
// which is what gives this bar its first filter.
const FILTER_DEFS = [{ key: "zone", label: "Zone", value: (r) => r.factionZoneName }];

const SEARCH_FIELDS = [(r) => r.name, (r) => r.preview];

export default function ConversationsTable({ conversations, myZoneName }) {
  const filterDefs = useMemo(() => FILTER_DEFS, []);
  const searchFields = useMemo(() => SEARCH_FIELDS, []);
  const { query, setQuery, filters, setFilters, sort, toggleSort, options, pageRows, page, setPage, total, totalPages } =
    useTableState({
      rows: conversations,
      filterDefs,
      searchFields,
      initialSort: { key: "lastAtMs", dir: "desc" },
      initialFilters: myZoneName ? { zone: myZoneName } : undefined,
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
      >
        <ZoneScopeToggle myZoneName={myZoneName} filters={filters} setFilters={setFilters} />
      </FilterBar>

      <TableScroll>
        <thead>
          <tr>
            <SortHeader label="Player" sortKey="name" sort={sort} onSort={toggleSort} />
            <SortHeader label="Zone" sortKey="factionZoneName" sort={sort} onSort={toggleSort} />
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
              <td className="whitespace-nowrap">
                <ZoneChip zoneName={row.factionZoneName} />
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
