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
import { updateFaction, deleteFaction, assignFactionMember } from "../actions";
import CheckField from "@/app/components/CheckField";
import CharacterLink from "@/app/components/CharacterLink";

const COL_COUNT = 7;

const SEARCH_FIELDS = [(f) => f.name];

// Modest by design: name search and name sort, nothing more — the row
// itself is the interesting part (the inline-edit form below), not the list
// mechanics around it.
export default function FactionsTable({ rows, rooms = [], members = [], applications = [] }) {
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
            <th scope="col">Silo</th>
            <th scope="col">Members</th>
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
              {/* The silo pointer. Re-pointing it moves nothing — the old
                  room keeps whatever is in it. */}
              <td>
                <Select name="siloRoomId" defaultValue={f.siloRoomId ?? ""} form={`faction-${f.id}`}>
                  <option value="">None</option>
                  {rooms.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.zoneName} · {r.locationName} · {r.name}
                      {r.locked ? " (locked)" : ""}
                    </option>
                  ))}
                </Select>
              </td>
              <td className="mono">
                {f.memberCount}
                {f.foundedInPlay ? " ✦" : ""}
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

      {/* The member mover. The player-facing actions all refuse to act
          outside your own faction, which is the check a GM is here to skip —
          so this posts its own action rather than reusing one of theirs. */}
      <section className="panel flex flex-col gap-3 p-3">
        <h2 className="panel-header">Move somebody</h2>
        <form action={assignFactionMember} className="flex flex-wrap items-end gap-2">
          <label className="field">
            <span className="field-label">Character</span>
            <Select name="characterId" required defaultValue="">
              <option value="" disabled>
                Choose a character…
              </option>
              {members.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.isLeader ? " ⚑" : c.isTreasurer ? " ⚜" : ""}
                </option>
              ))}
            </Select>
          </label>
          <label className="field">
            <span className="field-label">Faction</span>
            <Select name="factionId" required defaultValue="">
              <option value="" disabled>
                Choose a faction…
              </option>
              {rows.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </Select>
          </label>
          <CheckField name="isLeader" value="true">
            Leader
          </CheckField>
          <CheckField name="isTreasurer" value="true">
            Treasurer
          </CheckField>
          <SubmitButton pendingLabel="Moving…">Move</SubmitButton>
        </form>
        <p className="text-xs text-muted">
          Making somebody Leader demotes whoever held it. Any handshake they had open is dropped. ‡
        </p>
      </section>

      {/* Read-only. Answering an application for a faction would be answering
          for its officers; the mover above is the GM's way in. */}
      <section className="panel flex flex-col gap-3 p-3">
        <h2 className="panel-header">Pending applications ({applications.length})</h2>
        <table className="data-table">
          <thead>
            <tr>
              <th>Character</th>
              <th>Faction</th>
              <th>Direction</th>
              <th>Note</th>
            </tr>
          </thead>
          <tbody>
            {applications.map((a) => (
              <tr key={a.id}>
                <td>
                  <CharacterLink characterId={a.characterId} name={a.characterName} isGm />
                </td>
                <td>{a.factionName}</td>
                <td>{a.kind === "INVITE" ? "Invited by the faction" : "Asked to join"}</td>
                <td className="text-muted">{a.note || "—"}</td>
              </tr>
            ))}
            {applications.length === 0 && <EmptyRow cols={4}>None.</EmptyRow>}
          </tbody>
        </table>
      </section>
    </>
  );
}
