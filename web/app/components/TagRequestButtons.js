"use client";

import { useMemo, useState, useTransition } from "react";
import { sortTagsForMenu, menuCategories, formatCost, costColor } from "@/lib/characterCreation";
import { addableTags, removableTags, transferableTags } from "@/lib/tagRequests";
import RequestDialog from "./RequestDialog";
import { addTagRequest, removeTagRequest, transferTagRequest } from "../(app)/character/requestActions";

// The three tag-request menus. Add Tag reuses the category-tab + selectable
// row layout from PointBuy.js, but not PointBuy itself: there's no budget, no
// tier-chain math, and no point total here, so sharing the component would
// mean threading "no economy" flags through all of it.
function TagPicker({ tags, selectedId, onSelect }) {
  const offered = useMemo(() => sortTagsForMenu(tags), [tags]);
  const categories = useMemo(() => menuCategories(offered), [offered]);
  const [category, setCategory] = useState(categories[0] ?? null);
  const active = categories.includes(category) ? category : categories[0];
  const visible = offered.filter((t) => t.category === active);

  if (!offered.length) {
    return (
      <p className="text-sm" style={{ color: "var(--muted)" }}>
        Nothing available.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {categories.length > 1 && (
        <div className="flex flex-wrap gap-2">
          {categories.map((c) => (
            <button
              key={c}
              type="button"
              className={c === active ? "btn" : "btn-quiet"}
              onClick={() => setCategory(c)}
            >
              {c}
            </button>
          ))}
        </div>
      )}
      <div className="flex flex-col gap-2" style={{ maxHeight: "16rem", overflowY: "auto" }}>
        {visible.map((tag) => {
          const isSelected = tag.id === selectedId;
          return (
            <button
              key={tag.id}
              type="button"
              aria-pressed={isSelected}
              onClick={() => onSelect(isSelected ? null : tag.id)}
              className="panel flex w-full items-start gap-3 p-3 text-left"
              style={{
                borderLeftColor: tag.group?.color ?? undefined,
                borderLeftWidth: tag.group?.color ? 3 : undefined,
                outline: isSelected ? "1px solid var(--accent)" : undefined,
              }}
            >
              <span aria-hidden="true">{isSelected ? "◆" : "◇"}</span>
              <span className="min-w-0">
                <span className="flex flex-wrap items-baseline gap-2">
                  <span className="font-bold">{tag.name}</span>
                  {tag.pointCost ? (
                    <span className="text-xs" style={{ color: costColor(tag.pointCost) }}>
                      {formatCost(tag.pointCost)} pts
                    </span>
                  ) : null}
                  {tag.group?.name ? (
                    <span className="text-xs" style={{ color: "var(--muted)" }}>
                      {tag.group.name}
                    </span>
                  ) : null}
                </span>
                {tag.description && (
                  <span className="mt-1 block text-xs" style={{ color: "var(--muted)" }}>
                    {tag.description}
                  </span>
                )}
              </span>
            </button>
          );
        })}
        {visible.length === 0 && (
          <p className="text-sm" style={{ color: "var(--muted)" }}>
            Nothing available in this category.
          </p>
        )}
      </div>
    </div>
  );
}

function ResourceCostField({ value, onChange, max }) {
  return (
    <label className="field" style={{ width: "10rem" }}>
      <span className="field-label">Does this cost any resources? ⬢</span>
      <input type="number" min="0" max={max} value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

export default function TagRequestButtons({ catalog, characterTags, resources, otherCharacters }) {
  const [mode, setMode] = useState(null); // "add" | "remove" | "transfer"
  const [tagId, setTagId] = useState(null);
  const [spend, setSpend] = useState("0");
  const [recipient, setRecipient] = useState("");
  const [error, setError] = useState(null);
  const [pending, startTransition] = useTransition();

  const heldIds = useMemo(() => characterTags.map((ct) => ct.tagId), [characterTags]);
  const addable = useMemo(() => addableTags(catalog, heldIds), [catalog, heldIds]);
  const removable = useMemo(() => removableTags(characterTags), [characterTags]);
  const transferable = useMemo(() => transferableTags(characterTags), [characterTags]);

  function open(next) {
    setMode(next);
    setTagId(null);
    setSpend("0");
    setRecipient("");
    setError(null);
  }

  function submit(reason) {
    setError(null);
    startTransition(async () => {
      const res =
        mode === "add"
          ? await addTagRequest({ tagId, resourcesSpent: spend, reason })
          : mode === "remove"
            ? await removeTagRequest({ tagId, resourcesSpent: spend, reason })
            : await transferTagRequest({ tagId, toCharacterId: recipient, reason });
      if (!res?.ok) return setError(res?.error ?? "Something went wrong.");
      setMode(null);
    });
  }

  const canSubmit = mode === "transfer" ? Boolean(tagId && recipient) : Boolean(tagId);
  const title = mode === "add" ? "Add Tag" : mode === "remove" ? "Remove Tag" : "Transfer Tag";

  return (
    <>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn-quiet" onClick={() => open("add")}>
          Add Tag
        </button>
        <button type="button" className="btn-quiet" onClick={() => open("remove")} disabled={!removable.length}>
          Remove Tag
        </button>
        <button
          type="button"
          className="btn-quiet"
          onClick={() => open("transfer")}
          disabled={!transferable.length}
        >
          Transfer Tag
        </button>
      </div>

      <RequestDialog
        open={mode !== null}
        title={title}
        submitLabel={title}
        busy={pending}
        error={error}
        canSubmit={canSubmit}
        onCancel={() => !pending && setMode(null)}
        onConfirm={submit}
      >
        {mode === "add" && (
          <>
            <TagPicker tags={addable} selectedId={tagId} onSelect={setTagId} />
            <ResourceCostField value={spend} onChange={setSpend} max={resources} />
          </>
        )}

        {mode === "remove" && (
          <>
            <label className="field">
              <span className="field-label">Tag to remove</span>
              <select value={tagId ?? ""} onChange={(e) => setTagId(e.target.value || null)} required>
                <option value="" disabled>
                  Choose a tag…
                </option>
                {removable.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </label>
            <ResourceCostField value={spend} onChange={setSpend} max={resources} />
          </>
        )}

        {mode === "transfer" && (
          <>
            <label className="field">
              <span className="field-label">Item or Asset to hand over</span>
              <select value={tagId ?? ""} onChange={(e) => setTagId(e.target.value || null)} required>
                <option value="" disabled>
                  Choose a tag…
                </option>
                {transferable.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span className="field-label">Give it to</span>
              <select value={recipient} onChange={(e) => setRecipient(e.target.value)} required>
                <option value="" disabled>
                  Choose a player…
                </option>
                {otherCharacters.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
          </>
        )}
      </RequestDialog>
    </>
  );
}
