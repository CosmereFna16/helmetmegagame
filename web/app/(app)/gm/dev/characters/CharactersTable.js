"use client";

import Link from "next/link";
import { EmptyRow } from "@/app/components/EmptyState";
import { EnumPill, CHARACTER_STATUS } from "@/app/components/StatusPill";
import FactionLink from "@/app/components/FactionLink";
import CharacterAvatar from "@/app/components/CharacterAvatar";
import {
  useTableState,
  SortHeader,
  FilterBar,
  TableScroll,
} from "@/app/components/DataTable";
import Pager from "@/app/components/Pager";

const COL_COUNT = 5;

const FILTER_DEFS = [
  { key: "status", label: "Status", value: (c) => c.status },
  { key: "zoneName", label: "Zone", value: (c) => c.zoneName },
];

const SEARCH_FIELDS = [(c) => c.name, (c) => c.factionName, (c) => c.zoneName];

// The DataTable toolkit over the roster — same shape TagCatalog.js already
// proves. `rows` is a flat DTO from the server page (page.js); no Date
// objects cross that boundary, so avatarVersion travels as the epoch number
// CharacterAvatar already wants rather than Character.updatedAt itself.
export default function CharactersTable({ rows }) {
  const table = useTableState({
    rows,
    searchFields: SEARCH_FIELDS,
    filterDefs: FILTER_DEFS,
    initialSort: { key: "name", dir: "asc" },
  });

  return (
    <>
      <section className="panel flex flex-col gap-3 p-3">
        <FilterBar
          filterDefs={FILTER_DEFS}
          filters={table.filters}
          setFilters={table.setFilters}
          options={table.options}
          query={table.query}
          setQuery={table.setQuery}
          searchLabel="Search characters"
          searchPlaceholder="Name, faction, zone…"
        />
      </section>

      <TableScroll minWidth="640px">
        <thead>
          <tr>
            <SortHeader label="Name" sortKey="name" sort={table.sort} onSort={table.toggleSort} />
            <SortHeader label="Faction" sortKey="factionName" sort={table.sort} onSort={table.toggleSort} />
            <SortHeader label="Zone" sortKey="zoneName" sort={table.sort} onSort={table.toggleSort} />
            <SortHeader label="Status" sortKey="status" sort={table.sort} onSort={table.toggleSort} />
            <SortHeader label="Resources" sortKey="resources" sort={table.sort} onSort={table.toggleSort} />
          </tr>
        </thead>
        <tbody>
          {table.pageRows.map((c) => (
            <tr key={c.id}>
              <td>
                <Link href={`/gm/dev/characters/${c.id}`} className="menu-item inline-flex items-center gap-2">
                  <CharacterAvatar characterId={c.id} name={c.name} version={c.avatarVersion} />
                  {c.name}
                </Link>
              </td>
              <td>
                <FactionLink factionId={c.factionId} name={c.factionName} />
              </td>
              <td>{c.zoneName}</td>
              <td>
                <EnumPill map={CHARACTER_STATUS} value={c.status} />
              </td>
              <td>{c.resources} ⬢</td>
            </tr>
          ))}
          {table.pageRows.length === 0 && (
            <EmptyRow cols={COL_COUNT}>No characters match.</EmptyRow>
          )}
        </tbody>
      </TableScroll>

      <Pager
        page={table.page}
        totalPages={table.totalPages}
        total={table.total}
        unit="characters"
        onPage={table.setPage}
      />
    </>
  );
}
