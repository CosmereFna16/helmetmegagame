"use client";

import { TableScroll, SortHeader, useTableState } from "./DataTable";
import Pager from "./Pager";
import EmptyState from "./EmptyState";

// The book. Every DEPOT_* Request ever filed, newest first.
//
// It reads existing Request rows rather than a ledger table of its own: those
// rows already carry an `effect` snapshot of exactly what moved, they already
// show up on the GM desk, and they already undo. A second ledger would be a
// second thing to keep in step with the first.
export default function DepotLedgerTab({ ledger }) {
  const table = useTableState({
    rows: ledger,
    searchFields: [(r) => r.label, (r) => r.detail, (r) => r.who],
    filterDefs: [{ key: "label", label: "Kind", value: (r) => r.label }],
    initialSort: { key: "at", dir: "desc" },
  });

  if (!ledger.length) {
    return (
      <section className="panel p-5">
        <h2 className="panel-header">Ledger</h2>
        <EmptyState>Nothing has moved through the Depot yet. ‡</EmptyState>
      </section>
    );
  }

  return (
    <section className="panel p-5">
      <h2 className="panel-header">Ledger</h2>
      <p className="mt-1 text-sm text-muted">
        Everything that has moved through the station, and who moved it. ‡
      </p>

      <div className="mt-4 flex flex-col gap-3">
        <TableScroll minWidth="38rem">
          <thead>
            <tr>
              <SortHeader label="Turn" sortKey="at" sort={table.sort} onSort={table.toggleSort} />
              <SortHeader label="Kind" sortKey="label" sort={table.sort} onSort={table.toggleSort} />
              <th scope="col">What</th>
              <SortHeader label="Who" sortKey="who" sort={table.sort} onSort={table.toggleSort} />
              <SortHeader label="¢" sortKey="delta" sort={table.sort} onSort={table.toggleSort} />
            </tr>
          </thead>
          <tbody>
            {table.pageRows.map((row) => (
              <tr key={row.id}>
                <td className="mono text-muted">{row.turn ?? "—"}</td>
                <td>{row.label}</td>
                <td className="text-muted">{row.detail}</td>
                <td>{row.who}</td>
                <td
                  className={`mono ${row.delta > 0 ? "text-positive" : row.delta < 0 ? "text-danger" : "text-muted"}`}
                >
                  {row.delta ? `${row.delta > 0 ? "+" : ""}${row.delta}` : "—"}
                </td>
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
