"use client";

import { FilterBar, TableScroll, SortHeader, useTableState } from "./DataTable";
import Pager from "./Pager";
import TagChip from "./TagChip";

// The reference book: every priced tag in the game on one page, whether the
// station stocks it, buys it back, or both.
//
// This exists because the Order tab answers "what can I get" and a Merchant
// spends most of his time on a different question — "what is this thing in
// front of me worth, and would the station take it". A row here with no buy
// price is something Ravenheart makes and he can only ever sell; a row with no
// sell price is something the station will not take back. Both are worth
// knowing before you agree a price with a player.
const SEARCH_FIELDS = [(r) => r.name, (r) => r.description];
const FILTER_DEFS = [
  { key: "group", label: "Kind", value: (r) => r.groupName ?? "" },
  { key: "side", label: "Counter", value: (r) => r.side },
];

export default function DepotPriceListTab({ priceList }) {
  const table = useTableState({
    rows: priceList,
    searchFields: SEARCH_FIELDS,
    filterDefs: FILTER_DEFS,
    initialSort: { key: "name", dir: "asc" },
  });

  return (
    <section className="panel p-5">
      <h2 className="panel-header">Price List</h2>
      <p className="mt-1 text-sm text-muted">
        Everything the Depot has a price for, in either direction. An obol is one ⬢, so these
        are both what the station settles at and what the thing is worth. What you charge
        Ravenheart is between you and Ravenheart. ‡
      </p>

      <div className="mt-4 flex flex-col gap-3">
        <FilterBar
          filterDefs={FILTER_DEFS}
          filters={table.filters}
          setFilters={table.setFilters}
          options={table.options}
          query={table.query}
          setQuery={table.setQuery}
          searchLabel="Search the list"
        />

        <TableScroll minWidth="36rem">
          <thead>
            <tr>
              <SortHeader label="Ware" sortKey="name" sort={table.sort} onSort={table.toggleSort} />
              <SortHeader label="Station sells" sortKey="price" sort={table.sort} onSort={table.toggleSort} />
              <SortHeader label="Station buys" sortKey="sellPrice" sort={table.sort} onSort={table.toggleSort} />
              <SortHeader label="Held" sortKey="held" sort={table.sort} onSort={table.toggleSort} />
            </tr>
          </thead>
          <tbody>
            {table.pageRows.map((row) => (
              <tr key={row.id}>
                <td>
                  <TagChip tag={row.tag} />
                </td>
                <td className="mono">{row.price != null ? `${row.price} ¢` : "—"}</td>
                <td className="mono">{row.sellPrice != null ? `${row.sellPrice} ¢` : "—"}</td>
                <td className="mono text-muted">{row.held || "—"}</td>
              </tr>
            ))}
          </tbody>
        </TableScroll>
        <Pager
            page={table.page}
            totalPages={table.totalPages}
            total={table.total}
            unit="entries"
            onPage={table.setPage}
          />
      </div>
    </section>
  );
}
