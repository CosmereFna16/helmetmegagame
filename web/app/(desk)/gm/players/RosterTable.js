"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import FormError from "@/app/components/FormError";
import { EnumPill, CHARACTER_STATUS } from "@/app/components/StatusPill";
import DevCharacterButton from "@/app/components/DevCharacterButton";
import DevPanelModal from "@/app/components/DevPanelModal";
import FactionLink from "@/app/components/FactionLink";
import { useTableState, SortHeader, FilterBar, TableScroll } from "@/app/components/DataTable";
import ZoneChip from "@/app/components/ZoneChip";
import ZoneScopeToggle from "@/app/components/ZoneScopeToggle";
import { openingZoneName } from "@/lib/zones";
import FactionsPanel from "./FactionsPanel";
import Pager from "@/app/components/Pager";
import { GM_MESSAGE_MAX_LENGTH } from "@/lib/constants";
import { filterTagsByQuery, sortForMode, tagsById as buildTagsById } from "@/lib/characterCreation";
// bulkTagCharacters stays in (app) — it is shared GM plumbing, not this
// desk's own, so it keeps its home rather than following the table here.
import { bulkTagCharacters } from "@/app/(app)/gm/actions";
import { sendGmBroadcast } from "./actions";
import useSubmitOnEnter from "@/app/components/useSubmitOnEnter";

// The roster: the whole fleet at once, with the columns a GM actually asks
// about mid-turn. The old /gm/players table had nine and could not answer
// "who still hasn't moved" — the question that comes up most in the back half
// of a turn — so Acted and Tags are new here, as is the name linking into the
// player's own desk rather than only into the Dev Panel.
//
// Only two bulk verbs, and that is deliberate: message and tag are GM-safe.
// Bulk zone moves stay a superadmin verb on /gm/dev, so a button for it here
// would fail for most of the people looking at it.

const COL_COUNT = 11;

// The key "zone" means the zone SEAT — the zone their faction is keyed to —
// because that is what every other GM surface means by Zone and what a GM's
// default filter is keyed on. The physical one is "Standing in": a real and
// different question, not a duplicate.
const FILTER_DEFS = [
  { key: "zone", label: "Zone", value: (c) => c.factionZoneName },
  { key: "locationZone", label: "Standing in", value: (c) => c.zoneName },
  { key: "faction", label: "Faction", value: (c) => c.factionName },
  { key: "status", label: "Status", value: (c) => c.status },
];

const SEARCH_FIELDS = [(c) => c.name, (c) => c.roleTitle, (c) => c.factionName];

export default function RosterTable({
  characters,
  tags = [],
  myZoneNames,
  hasOpenTurn,
  factions,
  factionCount,
  initialTab,
  initialHighlightFactionId,
}) {
  const [view, setView] = useState(initialTab === "factions" ? "factions" : "players");
  // Which faction row the Factions tab highlights — set on load from the
  // `?faction=` search param (a link in from the Dossier column, a different
  // route under this same desk), and again whenever a FactionLink inside
  // this desk is clicked, so the click always lands on its own row rather
  // than just switching tabs.
  const [highlightFactionId, setHighlightFactionId] = useState(initialHighlightFactionId || null);
  // Keyed on character id rather than row index, so a selection survives
  // paging, filtering and sorting — the recipient list is what gets sent.
  const [selected, setSelected] = useState(new Set());
  const [composerOpen, setComposerOpen] = useState(false);
  const [tagBarOpen, setTagBarOpen] = useState(false);
  const [composerError, setComposerError] = useState(null);
  const [sending, startSending] = useTransition();
  // { characterId, name } of the Dev Panel currently open as a modal over
  // this desk, or null. Mirrors the adjudication desk's Workspace.js —
  // opening it never leaves /gm/players or resets the roster's filters.
  const [devPanel, setDevPanel] = useState(null);

  const filterDefs = useMemo(() => FILTER_DEFS, []);
  const searchFields = useMemo(() => SEARCH_FIELDS, []);
  const {
    query,
    setQuery,
    filters,
    setFilters,
    sort,
    toggleSort,
    options,
    pageRows,
    page,
    setPage,
    total,
    totalPages,
  } = useTableState({
    rows: characters,
    filterDefs,
    searchFields,
    initialSort: { key: "name", dir: "asc" },
    initialFilters: { zone: openingZoneName(myZoneNames) },
  });

  const onComposerKeyDown = useSubmitOnEnter();

  // Every FactionLink in this desk routes here rather than to /faction —
  // switch to the Factions tab and highlight the row, instead of leaving.
  function goToFaction(factionId) {
    setHighlightFactionId(factionId);
    setView("factions");
  }

  function toggle(id) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // Select-all applies to the filtered page, not the whole roster — a header
  // checkbox that quietly picks up 100 people you cannot see is how a
  // broadcast goes to the wrong room.
  const pageAllSelected = pageRows.length > 0 && pageRows.every((c) => selected.has(c.id));
  function togglePage() {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const c of pageRows) {
        if (pageAllSelected) next.delete(c.id);
        else next.add(c.id);
      }
      return next;
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="segmented self-start" role="group" aria-label="Roster view">
        <button type="button" aria-pressed={view === "players"} onClick={() => setView("players")}>
          Players ({characters.length})
        </button>
        <button type="button" aria-pressed={view === "factions"} onClick={() => setView("factions")}>
          Factions ({factionCount})
        </button>
      </div>

      {view === "factions" ? (
        <FactionsPanel
          factions={factions}
          highlightFactionId={highlightFactionId}
          onSelectFaction={goToFaction}
        />
      ) : (
        <>
          <FilterBar
            filterDefs={filterDefs}
            filters={filters}
            setFilters={setFilters}
            options={options}
            query={query}
            setQuery={setQuery}
            searchLabel="Search players"
          >
            <ZoneScopeToggle myZoneNames={myZoneNames} filters={filters} setFilters={setFilters} />
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
            {selected.size > 0 && (
              <button type="button" className="btn-quiet" onClick={() => setSelected(new Set())}>
                Clear
              </button>
            )}
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
              className="panel flex flex-col gap-3 p-4"
              onSubmit={(e) => {
                e.preventDefault();
                const message = new FormData(e.currentTarget).get("message")?.toString().trim();
                if (!message) return;
                setComposerError(null);
                startSending(async () => {
                  const res = await sendGmBroadcast({ characterIds: [...selected], message });
                  if (!res.ok) {
                    setComposerError(res.error);
                    return;
                  }
                  setComposerOpen(false);
                  setSelected(new Set());
                });
              }}
            >
              <label className="field">
                <span className="field-label">
                  Message ({selected.size} recipient{selected.size === 1 ? "" : "s"}, sent from
                  Bascinet)
                </span>
                <textarea
                  name="message"
                  rows={3}
                  required
                  maxLength={GM_MESSAGE_MAX_LENGTH}
                  onKeyDown={onComposerKeyDown}
                />
              </label>
              <FormError>{composerError}</FormError>
              <button type="submit" className="btn self-start" disabled={sending}>
                {sending ? "Sending…" : "Send"}
              </button>
            </form>
          )}

          {/* Eleven columns. Without a minWidth they compress to one word per
              line at 375px instead of scrolling inside the frame. */}
          <TableScroll minWidth="1040px">
            <thead>
              <tr>
                <th scope="col" className="col-fit">
                  <input
                    type="checkbox"
                    checked={pageAllSelected}
                    onChange={togglePage}
                    aria-label="Select every player on this page"
                  />
                </th>
                <SortHeader label="Name" sortKey="name" sort={sort} onSort={toggleSort} />
                <SortHeader label="Role" sortKey="roleTitle" sort={sort} onSort={toggleSort} />
                <SortHeader label="Zone" sortKey="factionZoneName" sort={sort} onSort={toggleSort} />
                <SortHeader label="Faction" sortKey="factionName" sort={sort} onSort={toggleSort} />
                <SortHeader label="Standing in" sortKey="zoneName" sort={sort} onSort={toggleSort} />
                <SortHeader label="Status" sortKey="status" sort={sort} onSort={toggleSort} />
                <th scope="col">Cursed</th>
                <SortHeader label="Acted" sortKey="acted" sort={sort} onSort={toggleSort} />
                <SortHeader label="Tags" sortKey="tagCount" sort={sort} onSort={toggleSort} />
                <SortHeader label="Resources" sortKey="resources" sort={sort} onSort={toggleSort} />
              </tr>
            </thead>
            <tbody>
              {pageRows.map((c) => (
                <tr key={c.id}>
                  {/* The box itself stays 16px; the padding is what makes the
                      tap target reach the 44px minimum. */}
                  <td style={{ padding: "12px 14px" }}>
                    <input
                      type="checkbox"
                      checked={selected.has(c.id)}
                      onChange={() => toggle(c.id)}
                      aria-label={`Select ${c.name}`}
                    />
                  </td>
                  <td>
                    <div className="flex items-center gap-2">
                      {/* Straight into their conversation — the verb this desk
                          exists for. The Dev Panel is one click further, off
                          the name itself. */}
                      <Link href={`/gm/players/${c.discordUserId}`} className="menu-item">
                        {c.name}
                      </Link>
                      <DevCharacterButton
                        characterId={c.id}
                        name={c.name}
                        onOpen={() => setDevPanel({ characterId: c.id, name: c.name })}
                      />
                    </div>
                  </td>
                  <td>{c.roleTitle ?? "-"}</td>
                  <td>
                    <ZoneChip zoneName={c.factionZoneName} />
                  </td>
                  <td>
                    <FactionLink
                      factionId={c.factionId}
                      name={c.factionName || "-"}
                      onSelect={goToFaction}
                    />
                  </td>
                  <td className="text-muted">{c.zoneName || "-"}</td>
                  <td>
                    <EnumPill map={CHARACTER_STATUS} value={c.status} />
                  </td>
                  <td style={{ color: c.cursed ? "var(--accent-text)" : "var(--muted)" }}>
                    {c.cursed ? "Cursed" : "-"}
                  </td>
                  <td
                    className="mono"
                    style={{ color: c.acted ? "var(--positive)" : "var(--muted)" }}
                  >
                    {!hasOpenTurn ? "-" : c.acted ? "yes" : "no"}
                  </td>
                  <td className="mono">{c.tagCount}</td>
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
        </>
      )}

      {devPanel && (
        <DevPanelModal
          characterId={devPanel.characterId}
          name={devPanel.name}
          onClose={() => setDevPanel(null)}
        />
      )}
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

  // Chain-aware ("group") rather than cost-then-name, so a chain's rungs sit
  // together in tier order in the picker.
  const sorted = useMemo(() => sortForMode(tags, "group", buildTagsById(tags)), [tags]);
  const matches = useMemo(() => filterTagsByQuery(sorted, query).slice(0, 40), [sorted, query]);

  // Narrowing the search until the chosen tag drops out of the list would
  // otherwise leave the <select> rendering blank while tagId still held the
  // old value — and both buttons enabled, ready to grant a tag nobody can
  // see. Cleared in the setter rather than an effect
  // (react-hooks/set-state-in-effect is an error in this repo).
  function changeQuery(next) {
    setQuery(next);
    if (tagId && !filterTagsByQuery(sorted, next).slice(0, 40).some((t) => t.id === tagId)) {
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
