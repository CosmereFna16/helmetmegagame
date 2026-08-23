"use client";

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
import { createCustomTag, updateCustomTag, deleteCustomTag } from "./actions";

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
  ["tradeable", "Tradeable"],
  ["visibleOnInspect", "Visible when 🔍-inspected"],
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
  visibleOnInspect: false,
};

export default function TagCatalog({ tags, groups, categories, canDelete }) {
  const confirm = useConfirm();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState(null);
  const [editing, setEditing] = useState(null); // null | {…tag} | "new"

  const table = useTableState({
    rows: tags,
    searchFields: SEARCH_FIELDS,
    filterDefs: FILTER_DEFS,
    initialSort: { key: "name", dir: "asc" },
  });

  const customCount = useMemo(() => tags.filter((t) => t.custom).length, [tags]);

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
          <button type="button" className="btn" onClick={() => setEditing("new")}>
            New tag
          </button>
        </FilterBar>
        <p className="text-xs text-muted">
          {customCount} GM-created, {tags.length - customCount} from docs/tags.yaml. A GM-created
          tag lives only in the database — <code>npm run db:sync-tags</code> never touches it, and{" "}
          <code>npm run db:prune-tags</code> skips it. Tags from the YAML are read-only here: edit
          them in the file, or the next sync reverts you.
        </p>
        {error && <p className="text-sm text-accent">{error}</p>}
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
                  {t.name}
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
                          message: "This removes the tag from the catalog permanently.",
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

      {editing && (
        <TagDialog
          tag={editing === "new" ? null : editing}
          groups={groups}
          categories={categories}
          pending={pending}
          error={error}
          onCancel={() => setEditing(null)}
          onSave={(values) =>
            run(() =>
              editing === "new"
                ? createCustomTag(values)
                : updateCustomTag({ tagId: editing.id, ...values }),
            )
          }
        />
      )}
    </>
  );
}

function TagDialog({ tag, groups, categories, pending, error, onCancel, onSave }) {
  const [values, setValues] = useState(() => (tag ? { ...BLANK, ...tag } : BLANK));
  const set = (key, value) => setValues((v) => ({ ...v, [key]: value }));

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal-panel flex flex-col gap-3" onClick={(e) => e.stopPropagation()}>
        <h2 className="panel-header">{tag ? `Edit ${tag.name}` : "New tag"}</h2>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="field">
            <span className="field-label">Name</span>
            <input value={values.name} maxLength={60} onChange={(e) => set("name", e.target.value)} />
          </label>
          <label className="field">
            <span className="field-label">Category</span>
            <select value={values.category} onChange={(e) => set("category", e.target.value)}>
              <option value="">Choose…</option>
              {categories.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="field-label">Group (colour accent only)</span>
            <select value={values.groupId ?? ""} onChange={(e) => set("groupId", e.target.value)}>
              <option value="">(none)</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>{g.name}</option>
              ))}
            </select>
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
        </div>

        <label className="field">
          <span className="field-label">Description</span>
          <textarea rows={3} value={values.description ?? ""} onChange={(e) => set("description", e.target.value)} />
        </label>

        <div className="grid gap-1 sm:grid-cols-2">
          {BOOLEAN_FIELDS.map(([key, label]) => (
            <label key={key} className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={Boolean(values[key])} onChange={(e) => set(key, e.target.checked)} />
              {label}
            </label>
          ))}
        </div>

        {tag && (
          <p className="mono text-xs text-muted">
            {tag.slug} — the slug is fixed after creation, since slug references elsewhere are
            plain strings with no key to follow.
          </p>
        )}

        {error && <p className="text-sm text-accent">{error}</p>}

        <div className="flex justify-end gap-2">
          <button type="button" className="btn-quiet" onClick={onCancel} disabled={pending}>
            Cancel
          </button>
          <button
            type="button"
            className="btn"
            disabled={pending || !values.name.trim() || !values.category}
            onClick={() => onSave(values)}
          >
            {pending ? "Saving…" : tag ? "Save" : "Create tag"}
          </button>
        </div>
      </div>
    </div>
  );
}
