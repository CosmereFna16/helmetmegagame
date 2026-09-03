"use client";

import FormError from "@/app/components/FormError";
import Modal from "@/app/components/Modal";
import CustomTagDialog from "@/app/components/CustomTagDialog";
import TagFieldset, { tagToFormValues } from "@/app/components/TagFieldset";
import { useMemo, useState, useTransition } from "react";
import {
  useTableState,
  SortHeader,
  FilterBar,
  TableScroll,
} from "@/app/components/DataTable";
import Pager from "@/app/components/Pager";
import IconButton from "@/app/components/IconButton";
import { useConfirm } from "@/app/components/ConfirmProvider";
import { EditIcon, TrashIcon } from "@/app/components/icons";
import { formatCost, costColor } from "@/lib/characterCreation";
import TagDetailSheet from "@/app/components/TagDetailSheet";
import { updateCustomTag, deleteCustomTag } from "./actions";

const FILTER_DEFS = [
  { key: "category", label: "Category", value: (t) => t.category },
  { key: "origin", label: "Origin", value: (t) => (t.custom ? "GM-created" : "docs/tags.yaml") },
];

const SEARCH_FIELDS = [(t) => t.name, (t) => t.slug, (t) => t.description, (t) => t.groupName];

// The field set itself lives in TagFieldset — shared with the quick
// CustomTagDialog, which used to carry a much smaller one of its own.

export default function TagCatalog({ tags, groups, categories, canDelete }) {
  const confirm = useConfirm();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState(null);
  const [editing, setEditing] = useState(null); // null | {…tag} — existing GM tag being edited
  const [viewing, setViewing] = useState(null); // null | {…tag} — the detail sheet
  const [creating, setCreating] = useState(false); // the shared CustomTagDialog
  // A just-created tag, shown immediately rather than waiting on the
  // router.refresh() CustomTagDialog already triggers — same reasoning as
  // TagEditor.js and EffectComposer.js's own doors.
  const [extraTags, setExtraTags] = useState([]);

  const allTags = useMemo(() => [...tags, ...extraTags], [tags, extraTags]);

  const table = useTableState({
    rows: allTags,
    searchFields: SEARCH_FIELDS,
    filterDefs: FILTER_DEFS,
    initialSort: { key: "name", dir: "asc" },
  });

  const customCount = useMemo(() => allTags.filter((t) => t.custom).length, [allTags]);

  function run(fn) {
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if (!res?.ok) {
        setError(res?.error ?? "Something went wrong.");
        return;
      }
      setEditing(null);
    });
  }

  // Confirm FIRST, transition SECOND — see the note in ActionBar.js. Awaiting
  // the dialog inside the transition deadlocks it against itself.
  async function confirmThenRun(opts, fn) {
    setError(null);
    if (!(await confirm(opts))) return;
    run(fn);
  }

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
          searchLabel="Search tags"
        >
          <button type="button" className="btn" onClick={() => setCreating(true)}>
            New tag
          </button>
        </FilterBar>
        <p className="text-xs text-muted">
          {customCount} GM-created, {allTags.length - customCount} from docs/tags.yaml. GM-created tags
          exist only in the database, so <code>npm run db:sync-tags</code> and{" "}
          <code>npm run db:prune-tags</code> leave them alone. Tags from the YAML are read-only here;
          edit them in the file, since the next sync overwrites any change made here.
        </p>
        <FormError>{error}</FormError>
      </section>

      <TableScroll minWidth="860px">
          <thead>
            <tr>
              <SortHeader label="Name" sortKey="name" sort={table.sort} onSort={table.toggleSort} />
              <SortHeader label="Category" sortKey="category" sort={table.sort} onSort={table.toggleSort} />
              <th scope="col">Group</th>
              <SortHeader label="Cost" sortKey="pointCost" sort={table.sort} onSort={table.toggleSort} />
              <SortHeader label="Held" sortKey="held" sort={table.sort} onSort={table.toggleSort} />
              <th scope="col">Origin</th>
              <th scope="col" aria-label="Edit" />
              <th scope="col" aria-label="Delete" />
            </tr>
          </thead>
          <tbody>
            {table.pageRows.map((t) => (
              <tr key={t.id}>
                <td>
                  {/* The name opens the read-only detail sheet — full
                      description, chain, links. A button rather than a row
                      onClick so the keyboard reaches it. */}
                  <button
                    type="button"
                    className="text-left font-[inherit] cursor-pointer"
                    onClick={() => setViewing(t)}
                  >
                    {t.name}
                  </button>
                  <div className="mono text-xs text-muted">{t.slug}</div>
                </td>
                <td className="mono text-sm">{t.category}</td>
                <td className="text-sm text-muted">{t.groupName ?? "—"}</td>
                <td className="mono text-sm" style={{ color: costColor(t.pointCost) }}>
                  {formatCost(t.pointCost)}
                </td>
                <td className="mono text-sm">{t.held || "—"}</td>
                <td className="text-sm text-muted">{t.custom ? "GM" : "YAML"}</td>
                <td>
                  <IconButton
                    icon={EditIcon}
                    label={t.custom ? `Edit ${t.name}` : "Edit this one in docs/tags.yaml"}
                    disabled={!t.custom}
                    onClick={() => setEditing(t)}
                  />
                </td>
                <td>
                  <IconButton
                    icon={TrashIcon}
                    label={
                      !t.custom
                        ? "Only a GM-created tag can be deleted here"
                        : t.held
                          ? "Characters still hold this tag"
                          : `Delete ${t.name}`
                    }
                    disabled={!canDelete || !t.custom || t.held > 0}
                    onClick={() =>
                      confirmThenRun(
                        {
                          title: `Delete ${t.name}?`,
                          message: "Permanently removes this tag from the catalog.",
                          confirmLabel: "Delete",
                        },
                        () => deleteCustomTag({ tagId: t.id }),
                      )
                    }
                  />
                </td>
              </tr>
            ))}
          </tbody>
      </TableScroll>

      <Pager
        page={table.page}
        totalPages={table.totalPages}
        total={table.total}
        unit="tags"
        onPage={table.setPage}
      />

      {viewing && (
        <TagDetailSheet
          tag={viewing}
          tags={allTags}
          onOpen={setViewing}
          onClose={() => setViewing(null)}
        />
      )}

      {editing && (
        <TagDialog
          tag={editing}
          tags={allTags}
          groups={groups}
          categories={categories}
          pending={pending}
          error={error}
          onCancel={() => setEditing(null)}
          onSave={(values) => run(() => updateCustomTag({ tagId: editing.id, ...values }))}
        />
      )}

      {creating && (
        <CustomTagDialog
          categories={categories}
          groups={groups}
          tags={allTags}
          onClose={() => setCreating(false)}
          onCreated={(tag) => {
            setExtraTags((prev) => [...prev, { ...tag, held: 0, groupName: groups.find((g) => g.id === tag.groupId)?.name ?? null }]);
            setCreating(false);
          }}
        />
      )}
    </>
  );
}

// Edit-only — creation moved to the shared CustomTagDialog (D11), which also
// grew Clone-from/Assign-to/stage-toggle this simpler form never needed. Both
// now render the same TagFieldset, so the two doors can't drift on which
// fields a GM can reach.
function TagDialog({ tag, tags, groups, categories, pending, error, onCancel, onSave }) {
  const [values, setValues] = useState(() => tagToFormValues(tag));
  const set = (key, value) => setValues((v) => ({ ...v, [key]: value }));

  return (
    <Modal title={`Edit ${tag.name}`} onClose={onCancel}>
      <div className="flex flex-col gap-3">
        <TagFieldset
          values={values}
          set={set}
          categories={categories}
          groups={groups}
          tags={tags}
          // A GM here came specifically to change a field, so the advanced
          // block starts open — unlike the quick dialog, where most tags are
          // simple and the disclosure keeps the modal short.
          advancedOpen
          selfId={tag.id}
        />

        <p className="mono text-xs text-muted">
          {tag.slug} — the slug cannot be changed after creation, because other tags refer to it
          by this exact text.
        </p>

        <FormError>{error}</FormError>

        <div className="modal-actions">
          <button type="button" className="btn-quiet" onClick={onCancel} disabled={pending}>
            Cancel
          </button>
          <button
            type="button"
            className="btn"
            disabled={pending || !values.name.trim() || !values.category}
            onClick={() => onSave(values)}
          >
            {pending ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
