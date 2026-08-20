"use client";

import { useMemo, useState } from "react";
import {
  purchasableTags,
  sortTagsForMenu,
  menuCategories,
  formatCost,
  costColor,
  totalCost,
} from "@/lib/characterCreation";

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
  const offered = useMemo(
    () =>
      sortTagsForMenu(
        purchasableTags({ tags, afterStartOnly, grantedNames: grantedTags.map((t) => t.name) }),
      ),
    [tags, afterStartOnly, grantedTags],
  );

  const categories = useMemo(() => menuCategories(offered), [offered]);
  const [category, setCategory] = useState(categories[0] ?? null);
  const active = categories.includes(category) ? category : categories[0];

  const selected = useMemo(
    () => offered.filter((t) => selectedIds.includes(t.id)),
    [offered, selectedIds],
  );
  const remaining = budget - totalCost(selected);

  function toggle(tag) {
    onChange(
      selectedIds.includes(tag.id)
        ? selectedIds.filter((id) => id !== tag.id)
        : [...selectedIds, tag.id],
    );
  }

  const visible = offered.filter((t) => t.category === active);

  return (
    <div className="flex flex-col gap-4">
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
          <span style={{ color: "var(--muted)" }}>Points remaining </span>
          <strong style={{ color: remaining < 0 ? "var(--accent)" : "var(--text)" }}>
            {remaining}
          </strong>
          <span style={{ color: "var(--muted)" }}> / {budget}</span>
        </div>
      </div>

      {remaining < 0 && (
        <p className="text-sm" style={{ color: "var(--accent)" }}>
          You&apos;re over budget by {Math.abs(remaining)}. Drop something to continue.
        </p>
      )}

      <ul className="flex flex-col gap-2">
        {visible.map((tag) => {
          const isSelected = selectedIds.includes(tag.id);
          const groupColor = tag.group?.color ? `var(--tag-${tag.group.color})` : null;
          // A tag you can't currently afford is still shown, just marked —
          // hiding it would make the catalog feel like it changes shape.
          const unaffordable = !isSelected && (tag.pointCost ?? 0) > remaining;
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
                  outline: isSelected ? "1px solid var(--accent)" : undefined,
                  opacity: unaffordable ? 0.55 : 1,
                  cursor: "pointer",
                }}
              >
                <span
                  aria-hidden="true"
                  className="mt-0.5 shrink-0 text-sm"
                  style={{ color: isSelected ? "var(--accent)" : "var(--muted)" }}
                >
                  {isSelected ? "◆" : "◇"}
                </span>
                <span className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="flex flex-wrap items-baseline gap-2">
                    <strong>{tag.name}</strong>
                    <span className="text-sm" style={{ color: costColor(tag.pointCost) }}>
                      {formatCost(tag.pointCost)}
                    </span>
                    {tag.group?.name && (
                      <span className="text-xs" style={{ color: "var(--muted)" }}>
                        {tag.group.name}
                      </span>
                    )}
                  </span>
                  {tag.description && (
                    <span className="text-sm" style={{ color: "var(--muted)" }}>
                      {tag.description}
                    </span>
                  )}
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      {visible.length === 0 && (
        <p className="text-sm" style={{ color: "var(--muted)" }}>
          Nothing available in this category.
        </p>
      )}
    </div>
  );
}
