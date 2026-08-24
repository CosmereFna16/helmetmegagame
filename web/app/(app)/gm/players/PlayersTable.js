"use client";

import FormError from "@/app/components/FormError";
import { EnumPill, CHARACTER_STATUS } from "@/app/components/StatusPill";
import { useMemo, useState, useTransition } from "react";
import { sendGmMessage, bulkTagCharacters } from "../actions";
import { filterTagsByQuery, sortTagsForMenu } from "@/lib/characterCreation";
import CharacterLink from "../../../components/CharacterLink";
import FactionLink from "../../../components/FactionLink";
import { useTableState, SortHeader, FilterBar, TableScroll } from "@/app/components/DataTable";
import ZoneChip from "@/app/components/ZoneChip";
import ZoneScopeToggle from "@/app/components/ZoneScopeToggle";
import Pager from "@/app/components/Pager";

const COL_COUNT = 9;

// The key "zone" used to mean the character's PHYSICAL zone. It now means the
// zone seat — the zone their faction is keyed to — because that is what every
// other GM surface means by Zone and what a GM's default filter is keyed on.
// The physical one is still here, renamed rather than dropped: it is the
// answer to a real and different question.
const FILTER_DEFS = [
  { key: "zone", label: "Zone", value: (c) => c.factionZoneName },
  { key: "locationZone", label: "Standing in", value: (c) => c.zoneName },
  { key: "faction", label: "Faction", value: (c) => c.factionName },
  { key: "status", label: "Status", value: (c) => c.status },
];

const SEARCH_FIELDS = [(c) => c.name, (c) => c.roleTitle, (c) => c.factionName];

export default function PlayersTable({ characters, tags = [], myZoneName }) {
  // Keyed on character id rather than row index, so a selection survives
  // paging, filtering and sorting — the recipient list is what gets sent.
  const [selected, setSelected] = useState(new Set());
  const [composerOpen, setComposerOpen] = useState(false);
  const [tagBarOpen, setTagBarOpen] = useState(false);

  const filterDefs = useMemo(() => FILTER_DEFS, []);
  const searchFields = useMemo(() => SEARCH_FIELDS, []);
  const { query, setQuery, filters, setFilters, sort, toggleSort, options, pageRows, page, setPage, total, totalPages } =
    useTableState({
      rows: characters,
      filterDefs,
      searchFields,
      initialSort: { key: "name", dir: "asc" },
      initialFilters: myZoneName ? { zone: myZoneName } : undefined,
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
        <ZoneScopeToggle myZoneName={myZoneName} filters={filters} setFilters={setFilters} />
        <button
          type="button"
          className="btn"
          disabled={selected.size === 0}
          onClick={() => setComposerOpen((open) => !open)}
        >
          Message selected ({selected.size})
        </button>
        <button
          type="button"
          className="btn"
          disabled={selected.size === 0}
          onClick={() => setTagBarOpen((open) => !open)}
        >
          Tag selected ({selected.size})
        </button>
      </FilterBar>

      {tagBarOpen && selected.size > 0 && (
        <BulkTagBar
          tags={tags}
          count={selected.size}
          characterIds={[...selected]}
          onDone={() => {
            setTagBarOpen(false);
            setSelected(new Set());
          }}
        />
      )}

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
            <span className="field-label">Message ({selected.size} recipient{selected.size === 1 ? "" : "s"}, sent from Bascinet)</span>
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
            <th scope="col" className="col-fit">
              <span className="sr-only">Select</span>
            </th>
            <SortHeader label="Name" sortKey="name" sort={sort} onSort={toggleSort} />
            <SortHeader label="Role" sortKey="roleTitle" sort={sort} onSort={toggleSort} />
            <SortHeader label="Zone" sortKey="factionZoneName" sort={sort} onSort={toggleSort} />
            <SortHeader label="Faction" sortKey="factionName" sort={sort} onSort={toggleSort} />
            <SortHeader label="Standing in" sortKey="zoneName" sort={sort} onSort={toggleSort} />
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
                <ZoneChip zoneName={c.factionZoneName} />
              </td>
              <td>
                <FactionLink factionId={c.factionId} name={c.factionName || "-"} />
              </td>
              <td className="text-muted">{c.zoneName || "-"}</td>
              <td>
                <EnumPill map={CHARACTER_STATUS} value={c.status} />
              </td>
              <td style={{ color: c.cursed ? "var(--accent-text)" : "var(--muted)" }}>
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

// Grant or revoke one tag across every selected row. The heavy lifting is
// bulkTagCharacters, which runs a transaction per character rather than one
// over the batch and reports partial success — so a single bad character
// can't roll back the rest.
function BulkTagBar({ tags, count, characterIds, onDone }) {
  const [pending, startTransition] = useTransition();
  const [query, setQuery] = useState("");
  const [tagId, setTagId] = useState("");
  const [result, setResult] = useState(null);

  const matches = useMemo(
    () => filterTagsByQuery(sortTagsForMenu(tags), query).slice(0, 40),
    [tags, query],
  );

  // Narrowing the search until the chosen tag drops out of the list would
  // otherwise leave the <select> rendering blank while tagId still held the
  // old value — and both buttons enabled, ready to grant a tag nobody can
  // see. Cleared in the setter rather than an effect
  // (react-hooks/set-state-in-effect is an error in this repo).
  function changeQuery(next) {
    setQuery(next);
    if (tagId && !filterTagsByQuery(sortTagsForMenu(tags), next).slice(0, 40).some((t) => t.id === tagId)) {
      setTagId("");
    }
  }

  function apply(mode) {
    setResult(null);
    startTransition(async () => {
      const res = await bulkTagCharacters({ characterIds, tagId, mode });
      if (!res?.ok) {
        setResult({ error: res?.error ?? "Something went wrong." });
        return;
      }
      setResult(res);
      if (!res.failed) onDone();
    });
  }

  return (
    <div className="panel flex flex-col gap-3 p-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="field">
          <span className="field-label">Find a tag</span>
          <input
            type="search"
            value={query}
            onChange={(e) => changeQuery(e.target.value)}
            placeholder="Name, description, or group"
          />
        </label>
        <label className="field">
          <span className="field-label">
            Tag to apply to {count} character{count === 1 ? "" : "s"}
          </span>
          <select value={tagId} onChange={(e) => setTagId(e.target.value)}>
            <option value="">Choose a tag…</option>
            {matches.map((t) => (
              <option key={t.id} value={t.id}>
                [{t.category}] {t.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="btn" disabled={pending || !tagId} onClick={() => apply("grant")}>
          Grant to all
        </button>
        <button type="button" className="btn-quiet" disabled={pending || !tagId} onClick={() => apply("revoke")}>
          Revoke from all
        </button>
        <button type="button" className="btn-quiet" onClick={onDone} disabled={pending}>
          Close
        </button>
      </div>

      <FormError>{result?.error}</FormError>
      {result?.ok && (
        <p className="text-sm text-muted">
          {result.tagName}: applied to {result.applied}
          {result.failed ? `, failed on ${result.failed}` : ""}.
        </p>
      )}
    </div>
  );
}
