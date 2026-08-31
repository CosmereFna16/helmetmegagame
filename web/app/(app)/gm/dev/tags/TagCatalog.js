"use client";

import FormError from "@/app/components/FormError";
import Modal from "@/app/components/Modal";
import CheckField from "@/app/components/CheckField";
import Select from "@/app/components/Select";
import CustomTagDialog from "@/app/components/CustomTagDialog";
import InfoIcon from "@/app/components/InfoIcon";
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
import TagDetailSheet from "./TagDetailSheet";
import { updateCustomTag, deleteCustomTag } from "./actions";

const FILTER_DEFS = [
  { key: "category", label: "Category", value: (t) => t.category },
  { key: "origin", label: "Origin", value: (t) => (t.custom ? "GM-created" : "docs/tags.yaml") },
];

const SEARCH_FIELDS = [(t) => t.name, (t) => t.slug, (t) => t.description, (t) => t.groupName];

const BOOLEAN_FIELDS = [
  ["purchasable", "Purchasable at creation"],
  ["purchasableAfterStart", "Still purchasable mid-game"],
  ["stackable", "Stackable"],
  ["equippable", "Equippable (takes a slot)"],
  ["consumable", "Consumable"],
  ["removable", "Player can drop it"],
  // Spelled out because it is easy to leave unchecked and then wonder why a
  // custom sword can't be handed over — it defaults off, and for an Item or an
  // Asset that is almost never what the GM meant.
  ["tradeable", "Tradeable (can be handed over, or looted off a body)"],
  ["sellable", "Sellable at Merchant's Depot"],
];

// Tag.inspectVisibility, the one tag setting that is not a boolean — a stowed
// dagger and a drawn one are different things to look at. WORN needs the tag
// to be equippable, which the server action re-checks (actions.js#scalarsFrom).
const VISIBILITY_OPTIONS = [
  ["HIDDEN", "Never"],
  ["ALWAYS", "Always"],
  ["WORN", "Only while equipped"],
];

const BLANK = {
  name: "",
  description: "",
  category: "",
  groupId: "",
  pointCost: 0,
  defaultDurationTurns: "",
  purchasable: false,
  purchasableAfterStart: false,
  stackable: false,
  equippable: false,
  consumable: false,
  removable: false,
  tradeable: false,
  inspectVisibility: "HIDDEN",
  sellable: false,
  sellablePrice: null,
};

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

// Edit-only now — creation moved to the shared CustomTagDialog (D11), which
// also grew Clone-from/Assign-to/stage-toggle this simpler form never needed.
function TagDialog({ tag, groups, categories, pending, error, onCancel, onSave }) {
  const [values, setValues] = useState(() => ({ ...BLANK, ...tag }));
  const set = (key, value) => setValues((v) => ({ ...v, [key]: value }));

  return (
    <Modal title={`Edit ${tag.name}`} onClose={onCancel}>
      <div className="flex flex-col gap-3">

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="field">
            <span className="field-label">Name</span>
            <input value={values.name} maxLength={60} onChange={(e) => set("name", e.target.value)} />
          </label>
          <label className="field">
            <span className="field-label">Category</span>
            <Select value={values.category} onChange={(e) => set("category", e.target.value)}>
              <option value="">Choose…</option>
              {categories.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </Select>
          </label>
          <label className="field">
            <span className="field-label">Group (colour accent only)</span>
            <Select value={values.groupId ?? ""} onChange={(e) => set("groupId", e.target.value)}>
              <option value="">(none)</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>{g.name}</option>
              ))}
            </Select>
          </label>
          <label className="field">
            <span className="field-label">Point cost (signed, catalog-style)</span>
            <input
              type="number"
              value={values.pointCost}
              onChange={(e) => set("pointCost", Number(e.target.value))}
            />
          </label>
          <label className="field">
            <span className="field-label">Lasts (turns, blank for permanent)</span>
            <input
              type="number"
              min="1"
              value={values.defaultDurationTurns ?? ""}
              onChange={(e) => set("defaultDurationTurns", e.target.value)}
            />
          </label>
          <label className="field">
            <span className="field-label">Seen by others on 🔍</span>
            <Select
              value={values.inspectVisibility ?? "HIDDEN"}
              onChange={(e) => set("inspectVisibility", e.target.value)}
            >
              {VISIBILITY_OPTIONS.map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </Select>
          </label>
          <label className="field">
            <span className="field-label flex items-center gap-1.5">
              Sellable price
              <InfoIcon text="Reference: a painting (4 turns to craft) sells for 60 ⬢. A flamethrower sells for 104 ⬢." />
            </span>
            <input
              type="number"
              min="1"
              value={values.sellablePrice ?? ""}
              onChange={(e) => set("sellablePrice", e.target.value)}
            />
          </label>
        </div>

        <label className="field">
          <span className="field-label">Description</span>
          <textarea rows={3} value={values.description ?? ""} onChange={(e) => set("description", e.target.value)} />
        </label>

        <div className="grid gap-1 sm:grid-cols-2">
          {BOOLEAN_FIELDS.map(([key, label]) => (
            <CheckField key={key} checked={Boolean(values[key])} onChange={(e) => set(key, e.target.checked)}>
              {label}
            </CheckField>
          ))}
        </div>

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
