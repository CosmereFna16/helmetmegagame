"use client";

import { useState, useTransition } from "react";
import { useTableState, SortHeader, FilterBar, TableScroll } from "@/app/components/DataTable";
import Pager from "@/app/components/Pager";
import { useConfirm } from "@/app/components/ConfirmProvider";
import { damageStructure, repairStructure, destroyStructure, clearStructure } from "./actions";

// The rulings table. Each verb re-checks everything server-side; a button
// here is a hint, not a lock. Confirm copy carries the rule that matters at
// the moment of clicking — pillar 4, printed where the ruling happens.

const DESTROY_CONFIRM = {
  title: "Destroy this structure? ‡",
  message:
    "It becomes a ruin on Examine and any edge it held reverts. A ruin cannot be repaired from this page — only cleared. If this resolves a player assault, remember the two-turn rule: the attack was declared publicly LAST turn — a siege never resolves the turn it is declared. ‡",
  confirmLabel: "Destroy ‡",
};

const CLEAR_CONFIRM = {
  title: "Clear this wreck? ‡",
  message: "The row is deleted — Examine forgets it entirely. There is no undo. ‡",
  confirmLabel: "Clear ‡",
};

const VERBS = {
  COMPLETE: [
    {
      label: "Damage ‡",
      action: damageStructure,
      confirm: {
        title: "Damage this structure? ‡",
        message:
          "It reads as damaged on Examine and the Move card, and its labor bonus or kit stops serving until repaired. Any edge it holds stays held. ‡",
        confirmLabel: "Damage ‡",
      },
    },
    { label: "Destroy ‡", action: destroyStructure, danger: true, confirm: DESTROY_CONFIRM },
  ],
  DAMAGED: [
    {
      label: "Repair ‡",
      action: repairStructure,
      confirm: {
        title: "Repair this structure? ‡",
        message: "It stands whole again, and its effects come back. ‡",
        confirmLabel: "Repair ‡",
      },
    },
    { label: "Destroy ‡", action: destroyStructure, danger: true, confirm: DESTROY_CONFIRM },
  ],
  UNDER_CONSTRUCTION: [
    {
      label: "Destroy ‡",
      action: destroyStructure,
      danger: true,
      confirm: {
        title: "Destroy this build site? ‡",
        message:
          "Sabotage destroys the work done, never silently: the site becomes a ruin on Examine and its crew are told. ‡",
        confirmLabel: "Destroy ‡",
      },
    },
  ],
  RUINED: [{ label: "Clear ‡", action: clearStructure, danger: true, confirm: CLEAR_CONFIRM }],
  ABANDONED: [
    {
      label: "Clear ‡",
      action: clearStructure,
      danger: true,
      confirm: {
        title: "Clear this abandoned groundwork? ‡",
        message: "The row is deleted — Examine forgets it entirely. There is no undo. ‡",
        confirmLabel: "Clear ‡",
      },
    },
  ],
};

const FILTER_DEFS = [
  { key: "zone", label: "Zone", value: (row) => row.zoneName },
  { key: "status", label: "Status", value: (row) => row.statusLabel },
];

export default function StructuresTable({ structures }) {
  const confirm = useConfirm();
  const [pending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState(null);

  const table = useTableState({
    rows: structures,
    searchFields: [
      (row) => row.typeName,
      (row) => row.locationName,
      (row) => row.builderName,
      (row) => row.payerName,
    ],
    filterDefs: FILTER_DEFS,
    initialSort: { key: "createdAtMs", dir: "desc" },
  });

  const run = async (row, verb) => {
    if (!(await confirm(verb.confirm))) return;
    setError(null);
    setBusyId(row.id);
    startTransition(async () => {
      const result = await verb.action({ structureId: row.id });
      if (!result.ok) setError(result.error);
      setBusyId(null);
    });
  };

  return (
    <div className="flex flex-col gap-3">
      <FilterBar
        filterDefs={FILTER_DEFS}
        filters={table.filters}
        setFilters={table.setFilters}
        options={table.options}
        query={table.query}
        setQuery={table.setQuery}
        searchLabel="Search ‡"
        searchPlaceholder="Type, place, builder… ‡"
      />
      {error && <p className="text-sm text-accent">{error}</p>}
      <TableScroll minWidth="64rem">
        <thead>
          <tr>
            <SortHeader label="Where ‡" sortKey="locationName" sort={table.sort} onSort={table.toggleSort} />
            <SortHeader label="Structure ‡" sortKey="typeName" sort={table.sort} onSort={table.toggleSort} />
            <SortHeader label="Status ‡" sortKey="statusLabel" sort={table.sort} onSort={table.toggleSort} />
            <th scope="col">Work ‡</th>
            <th scope="col">Crew ‡</th>
            <th scope="col">Builder ‡</th>
            <th scope="col">Paid ‡</th>
            <th scope="col">Edge ‡</th>
            <th scope="col">Rulings ‡</th>
          </tr>
        </thead>
        <tbody>
          {table.pageRows.map((row) => (
            <tr key={row.id}>
              <td>
                {row.zoneName} · {row.locationName}
              </td>
              <td>{row.typeName}</td>
              <td>{row.statusLabel}</td>
              <td className="mono">
                {row.turnsDone}/{row.turnsNeeded}
              </td>
              <td className="mono">{row.crew}</td>
              <td>{row.builderName}</td>
              <td>
                {row.resourcesCost > 0 ? (
                  <>
                    <span className="mono">{row.resourcesCost} ⬢</span>
                    <span className="text-muted"> — {row.payerName}</span>
                  </>
                ) : (
                  "—"
                )}
              </td>
              <td>
                {row.edgeLabel ? (
                  <>
                    {row.edgeLabel}{" "}
                    <span className="text-muted">{row.edgeOpen ? "(open) ‡" : "(shut) ‡"}</span>
                  </>
                ) : (
                  "—"
                )}
              </td>
              <td>
                <div className="flex flex-wrap gap-2">
                  {(VERBS[row.status] ?? []).map((verb) => (
                    <button
                      key={verb.label}
                      type="button"
                      className={verb.danger ? "btn-danger" : "btn-quiet"}
                      disabled={pending && busyId === row.id}
                      onClick={() => run(row, verb)}
                    >
                      {verb.label}
                    </button>
                  ))}
                </div>
              </td>
            </tr>
          ))}
          {table.pageRows.length === 0 && (
            <tr>
              <td colSpan={9} className="text-muted">
                Nothing has been built yet. ‡
              </td>
            </tr>
          )}
        </tbody>
      </TableScroll>
      <Pager page={table.page} totalPages={table.totalPages} onPage={table.setPage} total={table.total} />
    </div>
  );
}
