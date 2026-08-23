"use client";

import { useMemo, useState } from "react";
import {
  sortTagsForMenu,
  menuCategories,
  filterTagsByQuery,
  formatCost,
  costColor,
} from "@/lib/characterCreation";
import { tagDuration, turnsLeft } from "@/lib/turnFormat";
import ChipText from "@/app/components/ChipText";

// The GM's tag surface. Not PointBuy — that is the player's rules-respecting
// store and must stay that way. This is its sibling, sharing the same pure
// helpers but deliberately bypassing every gate:
//
//   - Every category, including the hidden ones (Demoness, Bacchus) and meta.
//     TAGS.md is explicit that a GM grant ignores requiredTag and the
//     TagGroup gate; this is the surface that does it, so unlike the player
//     menu nothing is filtered out by requirement.
//   - No budget. Cost is shown as information, never as a limit — tagPoints
//     is edited directly on the Identity tab.
//   - Quantity, equipped and expiry are all reachable, none of which the
//     player's store exposes.
//
// Everything here STAGES. Nothing is written until Apply, so a GM can build
// up a whole loadout and still back out of it.
export default function TagEditor({ tags, held, ops, openTurn, equipSlots, onStage }) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState(null);
  const [showHeldOnly, setShowHeldOnly] = useState(false);
  const [selected, setSelected] = useState(new Set());

  const heldByTagId = useMemo(() => new Map(held.map((h) => [h.tagId, h])), [held]);

  const sorted = useMemo(() => sortTagsForMenu(tags), [tags]);
  const categories = useMemo(() => menuCategories(sorted), [sorted]);
  const active = categories.includes(category) ? category : categories[0];

  const visible = useMemo(() => {
    const pool = showHeldOnly
      ? sorted.filter((t) => heldByTagId.has(t.id))
      : sorted.filter((t) => t.category === active);
    return filterTagsByQuery(pool, query);
  }, [sorted, showHeldOnly, heldByTagId, active, query]);

  const equippedCount = held.filter((h) => h.equipped).length;

  function toggleSelected(tagId) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(tagId)) next.delete(tagId);
      else next.add(tagId);
      return next;
    });
  }

  // Mass add: stage one `add` op per ticked tag in a single gesture, which is
  // the whole point — granting a starting loadout one dropdown at a time was
  // the old editor's worst habit.
  function grantSelected() {
    onStage([...selected].map((tagId) => ({ tagId, op: "add", quantity: 1 })));
    setSelected(new Set());
  }

  return (
    <>
      <section className="panel flex flex-col gap-3 p-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="field">
            <span className="field-label">Search</span>
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Name, description, or group"
            />
          </label>
          <div className="flex flex-col justify-end gap-2 text-sm">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={showHeldOnly}
                onChange={(e) => setShowHeldOnly(e.target.checked)}
              />
              Only what they hold ({held.length})
            </label>
            <span className="text-xs text-muted">
              Equipment {equippedCount} / {equipSlots}. GM grants ignore every requirement gate.
            </span>
          </div>
        </div>

        {!showHeldOnly && (
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
        )}

        {selected.size > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className="btn" onClick={grantSelected}>
              Grant {selected.size} selected
            </button>
            <button type="button" className="btn-quiet" onClick={() => setSelected(new Set())}>
              Clear selection
            </button>
          </div>
        )}
      </section>

      <ul className="flex flex-col gap-2">
        {visible.map((tag) => (
          <TagRow
            key={tag.id}
            tag={tag}
            holding={heldByTagId.get(tag.id) ?? null}
            op={ops.get(tag.id) ?? null}
            openTurn={openTurn}
            selected={selected.has(tag.id)}
            onToggleSelected={() => toggleSelected(tag.id)}
            onStage={onStage}
          />
        ))}
      </ul>

      {visible.length === 0 && (
        <p className="text-sm text-muted">
          {query ? `Nothing matches "${query}".` : "Nothing in this category."}
        </p>
      )}
    </>
  );
}

function TagRow({ tag, holding, op, openTurn, selected, onToggleSelected, onStage }) {
  const staged = op?.op ?? null;
  // A staged row is outlined and labelled, so the difference between "they
  // have this" and "they will have this once you press Apply" is never
  // guesswork.
  const outline =
    staged === "add"
      ? "1px solid var(--positive)"
      : staged === "remove"
        ? "1px solid var(--accent)"
        : staged
          ? "1px dashed var(--accent-text)"
          : undefined;

  const left = holding ? turnsLeft(holding.expiresTurn, openTurn?.number) : null;

  return (
    <li
      className="panel flex flex-col gap-2 p-3"
      style={{
        outline,
        borderLeftColor: tag.group?.color ?? undefined,
        borderLeftWidth: tag.group?.color ? 3 : undefined,
      }}
    >
      <div className="flex flex-wrap items-baseline gap-2">
        {!holding && (
          <input
            type="checkbox"
            checked={selected}
            onChange={onToggleSelected}
            aria-label={`Select ${tag.name} for a mass grant`}
          />
        )}
        <strong>{tag.name}</strong>
        <span className="text-sm" style={{ color: costColor(tag.pointCost) }}>
          {formatCost(tag.pointCost)}
        </span>
        {tag.group?.name && <span className="text-xs text-muted">{tag.group.name}</span>}
        {tag.custom && <span className="chip">custom</span>}
        {holding && (
          <span className="text-xs text-muted mono">
            held ×{holding.quantity} · {holding.source}
            {holding.equipped ? " · equipped" : ""}
            {/* tagDuration returns {label, badge} — TagChip destructures it. */}
            {holding.expiresTurn != null && ` · ${tagDuration(left, tag.defaultDurationTurns)?.label ?? ""}`}
          </span>
        )}
        {staged && (
          <span className="text-xs" style={{ color: "var(--accent-text)" }}>
            staged: {staged}
          </span>
        )}
      </div>

      {tag.description && <ChipText text={tag.description} as="p" className="text-sm text-muted" />}

      <div className="flex flex-wrap items-center gap-2">
        {holding ? (
          <>
            <button
              type="button"
              className="btn-quiet"
              onClick={() => onStage([{ tagId: tag.id, op: "remove", quantity: tag.stackable ? 1 : null }])}
            >
              {tag.stackable && holding.quantity > 1 ? "Take one" : "Remove"}
            </button>
            {tag.stackable && (
              <button
                type="button"
                className="btn-quiet"
                onClick={() => onStage([{ tagId: tag.id, op: "add", quantity: 1 }])}
              >
                Add one
              </button>
            )}
            {tag.equippable && (
              <button
                type="button"
                className="btn-quiet"
                onClick={() =>
                  onStage([{ tagId: tag.id, op: "patch", equipped: !holding.equipped }])
                }
              >
                {holding.equipped ? "Unequip" : "Equip"}
              </button>
            )}
            {tag.defaultDurationTurns != null && (
              <button
                type="button"
                className="btn-quiet"
                onClick={() => onStage([{ tagId: tag.id, op: "patch", expiry: { mode: "never" } }])}
              >
                Make permanent
              </button>
            )}
          </>
        ) : (
          <button
            type="button"
            className="btn-quiet"
            onClick={() => onStage([{ tagId: tag.id, op: "add", quantity: 1 }])}
          >
            Grant
          </button>
        )}
        {staged && (
          <button
            type="button"
            className="btn-quiet"
            onClick={() => onStage([{ tagId: tag.id, op: "clear" }])}
          >
            Unstage
          </button>
        )}
      </div>
    </li>
  );
}
