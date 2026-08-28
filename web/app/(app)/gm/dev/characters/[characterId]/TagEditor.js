"use client";

import { useMemo, useState } from "react";
import {
  sortForMode,
  menuCategories,
  filterTagsByQuery,
  formatCost,
  costColor,
  tagsById as buildTagsById,
} from "@/lib/characterCreation";
import { tagDuration, turnsLeft } from "@/lib/turnFormat";
import ChipText from "@/app/components/ChipText";
import ChipLabel from "@/app/components/ChipLabel";

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
//
// Layout: a permanent Held section up top (what they actually have, one line
// each, full actions), then the catalog browser below it, grouped by
// TagGroup so a chain reads together instead of scattering through a mile of
// panels. A held tag also appears in the catalog — that's deliberate, it's
// how a GM finds "Fighting II" to grant a second copy — but the catalog row
// only carries the not-yet-held actions; everything that touches an existing
// holding (remove, equip, expiry) lives in the Held section so it isn't
// staged from two places.
export default function TagEditor({ tags, held, ops, openTurn, equipSlots, onStage }) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState(null);
  const [selected, setSelected] = useState(new Set());

  const tagsById = useMemo(() => buildTagsById(tags), [tags]);
  const heldByTagId = useMemo(() => new Map(held.map((h) => [h.tagId, h])), [held]);

  // Chain-aware ("group") rather than cost-then-name, so Fighting's five
  // rungs sit together in tier order instead of scattering alphabetically.
  // Degrades to plain alphabetical if the rows lack parentTagId.
  const sorted = useMemo(() => sortForMode(tags, "group", tagsById), [tags, tagsById]);
  const categories = useMemo(() => menuCategories(sorted), [sorted]);
  const active = categories.includes(category) ? category : categories[0];

  // A non-empty query searches the whole catalog, not just the active tab —
  // a GM hunting "the paralysis one" shouldn't have to guess the category
  // first. Empty query goes back to plain category browsing.
  const searching = query.trim().length > 0;

  const visible = useMemo(() => {
    const pool = searching ? sorted : sorted.filter((t) => t.category === active);
    return filterTagsByQuery(pool, query);
  }, [sorted, searching, active, query]);

  // Bucket the visible list by TagGroup, in the order tags already sit
  // (chain order within a group). Ungrouped tags fall into one bucket at the
  // end, under no header.
  const groups = useMemo(() => {
    const byKey = new Map();
    for (const tag of visible) {
      const key = tag.group?.name ?? null;
      if (!byKey.has(key)) byKey.set(key, { group: tag.group ?? null, tags: [] });
      byKey.get(key).tags.push(tag);
    }
    const entries = [...byKey.values()];
    entries.sort((a, b) => {
      if (!a.group && !b.group) return 0;
      if (!a.group) return 1;
      if (!b.group) return -1;
      return a.group.name.localeCompare(b.group.name);
    });
    return entries;
  }, [visible]);

  const heldSorted = useMemo(() => {
    return [...held].sort((a, b) => {
      const ta = tagsById.get(a.tagId);
      const tb = tagsById.get(b.tagId);
      return (
        (ta?.category ?? "").localeCompare(tb?.category ?? "") ||
        a.name.localeCompare(b.name)
      );
    });
  }, [held, tagsById]);

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
              placeholder="Name, description, or group — searches every category"
            />
          </label>
          <div className="flex flex-col justify-end gap-2 text-sm">
            <span className="text-xs text-muted">
              Equipment {equippedCount} / {equipSlots}. GM grants ignore every requirement gate.
            </span>
          </div>
        </div>

        {!searching && (
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

      <section className="panel flex flex-col gap-1 p-3">
        <h3 className="field-label">Holds ({heldSorted.length})</h3>
        {heldSorted.length === 0 && <p className="text-sm text-muted">Holds nothing yet.</p>}
        <ul className="flex flex-col">
          {heldSorted.map((holding) => (
            <HeldRow
              key={holding.tagId}
              tag={tagsById.get(holding.tagId) ?? null}
              holding={holding}
              op={ops.get(holding.tagId) ?? null}
              openTurn={openTurn}
              onStage={onStage}
            />
          ))}
        </ul>
      </section>

      <section className="flex flex-col gap-3">
        {groups.map(({ group, tags: groupTags }) => (
          <div key={group?.name ?? "__ungrouped"} className="panel flex flex-col p-3">
            {group && (
              <div className="dev-tag-group-head">
                <span
                  className="dev-tag-swatch"
                  style={{ background: group.color ?? "var(--border)" }}
                  aria-hidden
                />
                {group.name}
              </div>
            )}
            <ul className="flex flex-col">
              {groupTags.map((tag) => (
                <CatalogRow
                  key={tag.id}
                  tag={tag}
                  holding={heldByTagId.get(tag.id) ?? null}
                  op={ops.get(tag.id) ?? null}
                  selected={selected.has(tag.id)}
                  onToggleSelected={() => toggleSelected(tag.id)}
                  onStage={onStage}
                  matchedDescriptionOnly={
                    searching &&
                    !nameMatches(tag, query) &&
                    !groupNameMatches(tag, query) &&
                    descriptionMatches(tag, query)
                  }
                  showCategoryChip={searching}
                />
              ))}
            </ul>
          </div>
        ))}
      </section>

      {visible.length === 0 && (
        <p className="text-sm text-muted">
          {query ? `Nothing matches "${query}".` : "Nothing in this category."}
        </p>
      )}
    </>
  );
}

function fold(value) {
  return (value ?? "").toString().toLowerCase();
}

function nameMatches(tag, query) {
  return fold(tag.name).includes(fold(query));
}

function groupNameMatches(tag, query) {
  return fold(tag.group?.name).includes(fold(query));
}

function descriptionMatches(tag, query) {
  return fold(tag.description).includes(fold(query));
}

// The staged outline, shared by the Held and catalog rows so the difference
// between "they have this" and "they will have this once you press Apply"
// reads the same everywhere.
function stagedOutline(staged) {
  return staged === "add"
    ? "1px solid var(--positive)"
    : staged === "remove"
      ? "1px solid var(--accent-text)"
      : staged
        ? "1px dashed var(--accent-text)"
        : undefined;
}

// One line in the Holds section — every action that touches an existing
// holding lives here: Remove/Take one, Add one, Equip toggle, Make
// permanent, and Unstage. `tag` is the catalog row (for stackable/equippable/
// defaultDurationTurns/group); it can be null if a held tag has fallen out of
// the fetched catalog, in which case those actions quietly don't render.
function HeldRow({ tag, holding, op, openTurn, onStage }) {
  const staged = op?.op ?? null;
  const left = turnsLeft(holding.expiresTurn, openTurn?.number);

  return (
    <li
      className="dev-tag-row"
      style={{ outline: stagedOutline(staged) }}
    >
      <span className="flex flex-wrap items-baseline gap-2 flex-1 min-w-0">
        {/* ChipLabel carries its own left edge in tag.group.color, so the
            row no longer needs one of its own. `holding.name` is the
            snapshot name (what the character actually holds); `tag` — the
            live catalog row, absent if it's since fallen out of the catalog
            — supplies the colour only. */}
        <ChipLabel tag={{ name: holding.name, group: tag?.group ?? null }} />
        {holding.quantity > 1 && <span className="mono text-xs text-muted">×{holding.quantity}</span>}
        <span className="text-xs text-muted mono">{holding.source}</span>
        {holding.equipped && <span className="chip">equipped</span>}
        {holding.expiresTurn != null && (
          <span className="text-xs text-muted">
            {/* tagDuration returns {label, badge} — TagChip destructures it. */}
            {tagDuration(left, tag?.defaultDurationTurns)?.label ?? ""}
          </span>
        )}
        {staged && (
          <span className="text-xs" style={{ color: "var(--accent-text)" }}>
            staged: {staged}
          </span>
        )}
      </span>

      <span className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="btn-quiet"
          onClick={() =>
            onStage([{ tagId: holding.tagId, op: "remove", quantity: tag?.stackable ? 1 : null }])
          }
        >
          {tag?.stackable && holding.quantity > 1 ? "Take one" : "Remove"}
        </button>
        {tag?.stackable && (
          <button
            type="button"
            className="btn-quiet"
            onClick={() => onStage([{ tagId: holding.tagId, op: "add", quantity: 1 }])}
          >
            Add one
          </button>
        )}
        {tag?.equippable && (
          <button
            type="button"
            className="btn-quiet"
            onClick={() => onStage([{ tagId: holding.tagId, op: "patch", equipped: !holding.equipped }])}
          >
            {holding.equipped ? "Unequip" : "Equip"}
          </button>
        )}
        {tag?.defaultDurationTurns != null && (
          <button
            type="button"
            className="btn-quiet"
            onClick={() => onStage([{ tagId: holding.tagId, op: "patch", expiry: { mode: "never" } }])}
          >
            Make permanent
          </button>
        )}
        {staged && (
          <button
            type="button"
            className="btn-quiet"
            onClick={() => onStage([{ tagId: holding.tagId, op: "clear" }])}
          >
            Unstage
          </button>
        )}
      </span>
    </li>
  );
}

// One line in the catalog. Held tags still show up here (that's how a GM
// finds a second copy or a higher tier of a chain they already hold) but
// carry only the not-yet-held action (Grant) plus Unstage — every action on
// an EXISTING holding lives in the Held section above, so a stage can't be
// pushed from two different rows for the same tag.
function CatalogRow({
  tag,
  holding,
  op,
  selected,
  onToggleSelected,
  onStage,
  matchedDescriptionOnly,
  showCategoryChip,
}) {
  const staged = op?.op ?? null;

  return (
    <li
      className="dev-tag-row"
      style={{ outline: stagedOutline(staged) }}
    >
      <span className="flex flex-wrap items-baseline gap-2 flex-1 min-w-0">
        {!holding && (
          <input
            type="checkbox"
            checked={selected}
            onChange={onToggleSelected}
            aria-label={`Select ${tag.name} for a mass grant`}
          />
        )}
        {/* ChipLabel carries its own left edge in tag.group.color, so the
            row no longer needs one of its own. */}
        <ChipLabel tag={tag} />
        <span className="text-sm" style={{ color: costColor(tag.pointCost) }}>
          {formatCost(tag.pointCost)}
        </span>
        {tag.custom && <span className="chip">custom</span>}
        {holding && <span className="chip">held</span>}
        {staged && (
          <span className="text-xs" style={{ color: "var(--accent-text)" }}>
            staged: {staged}
          </span>
        )}
        {showCategoryChip && <span className="chip">{tag.category}</span>}
        {tag.description && (
          <details className="text-sm text-muted">
            <summary className="text-xs cursor-pointer">
              {matchedDescriptionOnly ? "matches description" : "description"}
            </summary>
            <ChipText text={tag.description} as="p" className="text-sm text-muted" />
          </details>
        )}
      </span>

      <span className="flex flex-wrap items-center gap-2">
        {!holding && (
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
      </span>
    </li>
  );
}
