"use client";

import { useMemo, useState } from "react";
import {
  purchasableTags,
  sortTagsForMenu,
  menuCategories,
  formatCost,
  costColor,
  tagsById as buildTagsById,
  effectiveCost,
  effectiveTotalCost,
  chainSiblingsToRemove,
  unlockedTags,
  filterTagsByQuery,
} from "@/lib/characterCreation";
import { formatTagRequirement } from "@/lib/formatTagRequirement";
import ChipText from "./ChipText";

// The point-buy menu, shared by both stores.
//
// `afterStartOnly` is the single difference between them: character creation
// passes false and offers every purchasable tag, while the mid-game store
// passes true and offers only tags still buyable once play is underway — so a
// pick like "Secretly an Android" can be a launch-day option and never a
// mid-game one.
export default function PointBuy({
  tags,
  budget,
  grantedTags = [],
  afterStartOnly = false,
  selectedIds,
  onChange,
}) {
  // Full catalog by id, not just what's on offer, so a chain walk
  // (parentTagId) never dead-ends on a tag this menu happens to filter out.
  const byId = useMemo(() => buildTagsById(tags), [tags]);

  const offered = useMemo(
    () =>
      sortTagsForMenu(
        purchasableTags({ tags, afterStartOnly, grantedNames: grantedTags.map((t) => t.name) }),
      ),
    [tags, afterStartOnly, grantedTags],
  );

  // "Held" for cost/requirement purposes = granted-for-free tags plus
  // whatever's currently selected — a chain tier already granted by the role
  // discounts a purchase the same way an already-selected lower tier does.
  const grantedIds = useMemo(() => grantedTags.map((t) => t.id), [grantedTags]);
  const heldOrSelectedIds = useMemo(
    () => [...grantedIds, ...selectedIds],
    [grantedIds, selectedIds],
  );

  // Requirement filtering happens BEFORE the tabs are derived, not per row:
  // a category whose every tag is gated (Demoness, Bacchus) must have no tab
  // at all. Selected tags stay in, so unticking one can't make it vanish
  // mid-interaction.
  const unlocked = useMemo(
    () => unlockedTags(offered, byId, heldOrSelectedIds, selectedIds),
    [offered, byId, heldOrSelectedIds, selectedIds],
  );

  const [query, setQuery] = useState("");

  // Search runs AFTER unlockedTags, never instead of it: a gated tag must
  // stay invisible no matter what someone types. The category tabs are still
  // derived from `unlocked` rather than the searched set, so narrowing a
  // search can't make the tab you're standing on disappear underneath you.
  const categories = useMemo(() => menuCategories(unlocked), [unlocked]);
  const [category, setCategory] = useState(null);
  const active = categories.includes(category) ? category : categories[0];

  const selected = useMemo(
    () => offered.filter((t) => selectedIds.includes(t.id)),
    [offered, selectedIds],
  );
  const remaining = budget - effectiveTotalCost(selected, byId);

  function toggle(tag) {
    if (selectedIds.includes(tag.id)) {
      onChange(selectedIds.filter((id) => id !== tag.id));
      return;
    }
    const siblings = chainSiblingsToRemove(tag, byId, selectedIds);
    onChange([...selectedIds.filter((id) => !siblings.includes(id)), tag.id]);
  }

  const visible = filterTagsByQuery(
    unlocked.filter((t) => t.category === active),
    query,
  );

  return (
    <div className="flex flex-col gap-4">
      <label className="field">
        <span className="field-label">Search</span>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Name, description, or group"
        />
      </label>

      <div className="panel flex flex-wrap items-center justify-between gap-3 p-3">
        <div className="flex flex-wrap gap-2">
          {categories.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setCategory(c)}
              className={c === active ? "btn" : "btn-quiet"}
            >
              {c}
            </button>
          ))}
        </div>
        <div className="text-sm" aria-live="polite">
          <span className="text-muted">Points remaining </span>
          <strong style={{ color: remaining < 0 ? "var(--accent-text)" : "var(--text)" }}>
            {remaining}
          </strong>
          <span className="text-muted"> / {budget}</span>
        </div>
      </div>

      {remaining < 0 && (
        <p className="text-sm text-accent">
          You&apos;re over budget by {Math.abs(remaining)}. Drop something to continue.
        </p>
      )}

      {/* Deliberately a toggle-set, with no quantity anywhere: a bought tag
          lands on CharacterTag.quantity's default of 1, so a stackable tag
          can never be point-farmed. Stacks are built in play, through the
          Add Tag request. */}
      <ul className="flex flex-col gap-2">
        {visible.map((tag) => {
          const isSelected = selectedIds.includes(tag.id);
          // TagGroup.color is a freeform hex string, used raw — same as
          // TagChip.js. It was wrapped as var(--tag-<hex>) here, a token that
          // has never existed, so group colours silently didn't render.
          const groupColor = tag.group?.color ?? null;
          const cost = effectiveCost(tag, byId, heldOrSelectedIds);
          // A tag you can't currently afford is still shown, just marked —
          // hiding it would make the catalog feel like it changes shape.
          // A locked one (unmet requiredTag, or an unmet group gate) never
          // reaches here at all: `unlocked` above dropped it, along with its
          // category tab.
          const unaffordable = !isSelected && cost > remaining;
          return (
            <li key={tag.id}>
              <button
                type="button"
                onClick={() => toggle(tag)}
                aria-pressed={isSelected}
                className="panel flex w-full items-start gap-3 p-3 text-left"
                style={{
                  borderLeftColor: groupColor ?? undefined,
                  borderLeftWidth: groupColor ? 3 : undefined,
                  outline: isSelected ? "1px solid var(--accent-text)" : undefined,
                  opacity: unaffordable ? 0.55 : 1,
                  cursor: "pointer",
                }}
              >
                <span
                  aria-hidden="true"
                  className="mt-0.5 shrink-0 text-sm"
                  style={{ color: isSelected ? "var(--accent-text)" : "var(--muted)" }}
                >
                  {isSelected ? "◆" : "◇"}
                </span>
                <span className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="flex flex-wrap items-baseline gap-2">
                    <strong>{tag.name}</strong>
                    <span className="text-sm" style={{ color: costColor(cost) }}>
                      {formatCost(cost)}
                    </span>
                    {tag.group?.name && (
                      <span className="text-xs text-muted">
                        {tag.group.name}
                      </span>
                    )}
                  </span>
                  {/* ChipText rather than RichText: the row is a <button>,
                      so a hoverable chip inside it would be a button in a
                      button. */}
                  {tag.description && (
                    <ChipText text={tag.description} as="span" className="text-sm text-muted" />
                  )}
                  {formatTagRequirement(tag) && (
                    <span className="text-sm text-muted">
                      {formatTagRequirement(tag)}
                    </span>
                  )}
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      {visible.length === 0 && (
        <p className="text-sm text-muted">
          {query
            ? `Nothing in ${active} matches "${query}".`
            : "Nothing available in this category."}
        </p>
      )}
    </div>
  );
}
