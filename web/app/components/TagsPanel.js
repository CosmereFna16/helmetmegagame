"use client";

import { useMemo, useState } from "react";
import TagChip from "./TagChip";
import TagPointsValue from "./TagPointsValue";
import { useRequestActions } from "./RequestActionsProvider";
import EquipmentPanel from "./EquipmentPanel";
import Modal from "./Modal";
import StorePanel from "./StorePanel";
import { useTags } from "./TagsProvider";
import { heldSlugsOf } from "@/lib/consumeGrants";

// The Tags section of a character sheet. It's a client component for one
// reason: clicking a consumable chip opens the Consume dialog already pointed
// at that tag, via RequestActionsProvider's context.
//
// Equipment lives here too, as an embedded EquipmentPanel sub-section —
// equipped items are just a view over the same held-tags data this panel
// already renders, so a standalone Equipment card was one more scroll stop
// for no new information. "Spend Tag Points" (StorePanel inside a Modal)
// sits in this header next to the Tag Points readout it spends, rather than
// as its own nav destination.

// Fixed display order rather than alphabetical or catalog order — Status
// (needs, buffs/debuffs) and Health (whatever is currently wrong with you)
// belong near the top, ahead of General/Skills.
const CATEGORY_ORDER = [
  "Meta",
  "Status",
  "Health",
  "General",
  "Skills",
  "Items",
  "Assets",
  "Demoness",
  "Bacchus",
];

function categoryRank(category) {
  const i = CATEGORY_ORDER.indexOf(category);
  return i === -1 ? CATEGORY_ORDER.length : i;
}

// Groups the CharacterTag rows, not the bare Tags — the wrapper carries
// expiresTurn and quantity, which the chip and its countdown need.
function groupTagsByCategory(characterTags) {
  const groups = new Map();
  for (const ct of characterTags) {
    const category = ct.tag.category?.trim() || "Other";
    if (!groups.has(category)) groups.set(category, []);
    groups.get(category).push(ct);
  }
  return [...groups.entries()].sort(
    (a, b) => categoryRank(a[0]) - categoryRank(b[0]) || a[0].localeCompare(b[0]),
  );
}

// The catalog, resources, co-located rosters and heal targets all moved to
// RequestActionsProvider with the dialogs that used them — this panel only
// ever renders what the character already holds.
export default function TagsPanel({
  characterTags,
  isSelf,
  currentTurn = null,
  tagPoints = null,
  equipSlots = 6,
  // The mid-game store's catalog and this character's standing within it —
  // undefined for a viewer looking at someone else's sheet (mode !== "self"),
  // which is also why the button below only ever renders for isSelf.
  storeTags = null,
  storeHeldTags = null,
}) {
  // Null on someone else's sheet, where no provider is mounted — which is
  // also exactly when the chips must stay read-only.
  const openDialog = useRequestActions()?.open ?? null;
  const [storeOpen, setStoreOpen] = useState(false);

  const { tagsBySlug } = useTags();
  const tagGroups = useMemo(() => groupTagsByCategory(characterTags), [characterTags]);
  const heldSlugs = useMemo(() => heldSlugsOf(characterTags), [characterTags]);

  // Tag.consumesInto carries slugs; the app-wide catalog turns them into
  // names. It arrives via fetch, so fall back to the raw slug meanwhile.
  // Resolved against what this character holds, since a grant can be
  // conditional (Fine Meal cheers everyone but a noble) — promising a tag the
  // grant won't deliver would be worse than saying nothing. A
  // consumesIntoOneOf position (Skinned Cave Rat) is rendered as "A or B"
  // rather than rolled — resolveConsumeGrants commits to a real pick, and
  // this hint must not re-roll on every hover.
  function consumeHintFor(tag) {
    const names = (tag?.consumesInto ?? [])
      .map((slug, i) => {
        const blockers = tag?.consumesIntoUnless?.[slug] ?? null;
        if (blockers?.some((b) => heldSlugs.has(b))) return null;
        const alternatives = tag?.consumesIntoOneOf?.[i];
        return Array.isArray(alternatives)
          ? alternatives.map((s) => tagsBySlug.get(s)?.name ?? s).join(" or ")
          : (tagsBySlug.get(slug)?.name ?? slug);
      })
      .filter(Boolean);
    return names.length ? `Click to consume → ${names.join(", ")}` : "Click to consume";
  }

  return (
    <section className="panel p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h2 className="section-title">Tags</h2>
          {tagPoints != null && isSelf && storeTags && (
            <button type="button" className="btn-quiet" onClick={() => setStoreOpen(true)}>
              Spend Tag Points (<TagPointsValue points={tagPoints} />)
            </button>
          )}
          {tagPoints != null && !(isSelf && storeTags) && (
            <span className="text-sm">
              <span className="text-muted">Tag points </span>
              <TagPointsValue points={tagPoints} />
            </span>
          )}
        </div>
      </div>

      <div className="mb-3 border-b pb-3" style={{ borderColor: "var(--border)" }}>
        <EquipmentPanel
          characterTags={characterTags}
          slots={equipSlots}
          isSelf={isSelf}
          embedded
        />
      </div>

      {isSelf && storeTags && (
        <Modal
          open={storeOpen}
          onClose={() => setStoreOpen(false)}
          title="Spend Tag Points"
          width="widest"
        >
          <StorePanel
            tags={storeTags}
            budget={tagPoints ?? 0}
            heldTags={storeHeldTags ?? []}
            onDone={() => setStoreOpen(false)}
          />
        </Modal>
      )}

      {tagGroups.length === 0 ? (
        <p className="text-sm text-muted">No tags yet.</p>
      ) : (
        <div className="flex flex-col gap-3">
          {tagGroups.map(([category, tags]) => (
            <div key={category}>
              <p className="field-label mb-1">{category}</p>
              <ul className="flex flex-wrap gap-2">
                {tags.map((ct) => {
                  // Only your own consumables are clickable — someone else's
                  // sheet stays a read-only hover tooltip.
                  const clickable = isSelf && ct.tag.consumable && openDialog;
                  return (
                    <li key={ct.tag.id}>
                      <TagChip
                        tag={ct.tag}
                        quantity={ct.quantity}
                        onConsume={clickable ? () => openDialog("consume", ct.tag.id) : null}
                        consumeHint={clickable ? consumeHintFor(ct.tag) : null}
                        expiresTurn={ct.expiresTurn}
                        currentTurn={currentTurn}
                      />
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
