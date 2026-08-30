"use client";

import { useMemo, useState, useTransition } from "react";
import { unstarNote } from "./actions";
import { useConfirm } from "../../components/ConfirmProvider";
import Tooltip from "../../components/Tooltip";
import CharacterAvatar from "@/app/components/CharacterAvatar";
import EmptyState from "@/app/components/EmptyState";
import { useTableState, FilterBar } from "@/app/components/DataTable";
import Pager from "@/app/components/Pager";

const FILTER_DEFS = [{ key: "zone", label: "Zone", value: (n) => n.zoneName }];

const SEARCH_FIELDS = [(n) => n.content, (n) => n.characterName];

// A card list has no header row to hang a SortHeader off, so its sort is a
// select in the filter bar instead.
const SORT_OPTIONS = [
  { key: "sentAtMs", dir: "desc", label: "Newest first" },
  { key: "sentAtMs", dir: "asc", label: "Oldest first" },
];

export default function StarredList({ notes }) {
  const confirm = useConfirm();
  const [removed, setRemoved] = useState(new Set());
  const [isPending, startTransition] = useTransition();

  const filterDefs = useMemo(() => FILTER_DEFS, []);
  const searchFields = useMemo(() => SEARCH_FIELDS, []);
  // Optimistically-removed notes are dropped before the hook sees them, so
  // the count and the page boundaries stay honest after an unstar.
  const rows = useMemo(() => notes.filter((n) => !removed.has(n.id)), [notes, removed]);

  const { query, setQuery, filters, setFilters, sort, setSort, options, pageRows, page, setPage, total, totalPages } =
    useTableState({
      rows,
      filterDefs,
      searchFields,
      initialSort: { key: "sentAtMs", dir: "desc" },
    });

  async function handleUnstar(id) {
    if (!(await confirm({ title: "Unstar this note?", message: "This can't be undone.", confirmLabel: "Unstar" })))
      return;
    setRemoved((prev) => new Set(prev).add(id));
    startTransition(() => {
      unstarNote(id);
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
        searchLabel="Search notes"
        sortOptions={SORT_OPTIONS}
        sort={sort}
        setSort={setSort}
      />

      <div className="list-scroll flex flex-col gap-3">
        {pageRows.map((note) => (
          <div key={note.id} className="panel flex flex-col gap-2 p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2">
                <CharacterAvatar characterId={note.characterId} name={note.characterName} size={20} />
                <div className="flex flex-col">
                  <span className="font-bold">{note.characterName}</span>
                  <span className="text-xs text-muted">
                    {note.zoneName ?? "-"} · {new Date(note.sentAt).toLocaleString()}
                  </span>
                </div>
              </div>
              <Tooltip text="Unstar">
                <button
                  type="button"
                  className="btn-quiet"
                  onClick={() => handleUnstar(note.id)}
                  disabled={isPending}
                  aria-label="Unstar this note"
                >
                  [★]
                </button>
              </Tooltip>
            </div>
            <p className="whitespace-pre-wrap text-sm">{note.content}</p>
          </div>
        ))}
        {pageRows.length === 0 && <EmptyState>No starred messages match these filters.</EmptyState>}
      </div>

      <Pager page={page} totalPages={totalPages} total={total} unit="notes" onPage={setPage} />
    </div>
  );
}
