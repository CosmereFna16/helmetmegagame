"use client";

import SubmitButton from "@/app/components/SubmitButton";
import Select from "@/app/components/Select";
import ZoneChip from "@/app/components/ZoneChip";
import { EmptyRow } from "@/app/components/EmptyState";
import {
  useTableState,
  SortHeader,
  FilterBar,
  TableScroll,
} from "@/app/components/DataTable";
import Pager from "@/app/components/Pager";
// A "use server" module imported into a client component — the supported
// pattern (ConversationPane.js does the same with its own actions module).
import { updateFaction, deleteFaction } from "../actions";

const COL_COUNT = 6;

const SEARCH_FIELDS = [(f) => f.name];

// Modest by design: name search and name/silo sort, nothing more — the row
// itself is the interesting part (the inline-edit form below), not the list
// mechanics around it.
export default function FactionsTable({ rows }) {
  const table = useTableState({
    rows,
    searchFields: SEARCH_FIELDS,
    filterDefs: [],
    initialSort: { key: "name", dir: "asc" },
  });

  return (
    <>
      <section className="panel flex flex-col gap-3 p-3">
        <FilterBar
          filterDefs={[]}
          filters={table.filters}
          setFilters={table.setFilters}
          options={table.options}
          query={table.query}
          setQuery={table.setQuery}
          searchLabel="Search factions"
        />
      </section>

      <TableScroll minWidth="640px">
        <thead>
          <tr>
            <SortHeader label="Name" sortKey="name" sort={table.sort} onSort={table.toggleSort} />
            <th scope="col">Zone</th>
            <th scope="col">Parent</th>
            <SortHeader label="Silo" sortKey="silo" sort={table.sort} onSort={table.toggleSort} />
            <th scope="col" aria-label="Save" />
            <th scope="col" aria-label="Delete" />
          </tr>
        </thead>
        <tbody>
          {table.pageRows.map((f) => (
            <tr key={f.id}>
              <td>
                <form action={updateFaction} id={`faction-${f.id}`} className="contents">
                  <input type="hidden" name="factionId" value={f.id} />
                </form>
                <input name="name" defaultValue={f.name} form={`faction-${f.id}`} className="control" />
              </td>
              {/* Read-only: a faction's zone is owned by docs/roles.yaml and
                  written by db:sync-roles, so editing it here would be
                  overwritten on the next sync. */}
              <td>
                <ZoneChip zoneName={f.zoneName} />
              </td>
              <td>
                <Select
                  name="parentFactionId"
                  defaultValue={f.parentFactionId ?? ""}
                  form={`faction-${f.id}`}
                >
                  <option value="">None</option>
                  {rows
                    .filter((other) => other.id !== f.id)
                    .map((other) => (
                      <option key={other.id} value={other.id}>
                        {other.name}
                      </option>
                    ))}
                </Select>
              </td>
              <td>
                <input
                  type="number"
                  name="silo"
                  defaultValue={f.silo}
                  form={`faction-${f.id}`}
                  className="control w-24"
                />
              </td>
              <td>
                {/* Outside its <form> (wired by form={...}), so useFormStatus
                    cannot see it — SubmitButton reads the nearest ENCLOSING
                    form, and there isn't one. Stays a plain button. */}
                <button type="submit" form={`faction-${f.id}`} className="btn-quiet">
                  Save
                </button>
              </td>
              <td>
                {f.deletable && (
                  <form action={deleteFaction}>
                    <input type="hidden" name="factionId" value={f.id} />
                    <SubmitButton className="btn-quiet" pendingLabel="Deleting…">
                      Delete
                    </SubmitButton>
                  </form>
                )}
              </td>
            </tr>
          ))}
          {table.pageRows.length === 0 && (
            <EmptyRow cols={COL_COUNT}>No factions match.</EmptyRow>
          )}
        </tbody>
      </TableScroll>

      <Pager
        page={table.page}
        totalPages={table.totalPages}
        total={table.total}
        unit="factions"
        onPage={table.setPage}
      />
    </>
  );
}
