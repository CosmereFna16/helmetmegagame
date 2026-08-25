"use client";

import { useCallback, useMemo, useState } from "react";
import TagChip from "./TagChip";
import TagPointsValue from "./TagPointsValue";
import TagRequestButtons from "./TagRequestButtons";
import { useTags } from "./TagsProvider";
import { resolveConsumeGrants, heldSlugsOf } from "@/lib/consumeGrants";

// The Tags section of a character sheet. It's a client component for one
// reason: the chips and the request buttons have to share state, so that
// clicking a consumable tag can open the Consume dialog already pointed at
// it. Everything else here is the markup that used to sit inline in
// CharacterSheet.js.

// Fixed display order rather than alphabetical or catalog order — Status
// (Mood, buffs/debuffs) and Health (whatever is currently wrong with you)
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
// expiresTurn and quantity, which the chip and the mood countdown need.
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

export default function TagsPanel({
  characterTags,
  isSelf,
  catalog,
  resources,
  otherCharacters,
  currentTurn = null,
  selfId = null,
  canHeal = false,
  healTargets = [],
  healParties = null,
  tagPoints = null,
}) {
  // TagRequestButtons owns the dialog, and hands its opener up through
  // onReady so a chip click can drive it.
  const [openDialog, setOpenDialog] = useState(null);
  const onReady = useCallback((open) => setOpenDialog(() => open), []);

  const { tagsBySlug } = useTags();
  const tagGroups = useMemo(() => groupTagsByCategory(characterTags), [characterTags]);
  const heldSlugs = useMemo(() => heldSlugsOf(characterTags), [characterTags]);

  // Tag.consumesInto carries slugs; the app-wide catalog turns them into
  // names. It arrives via fetch, so fall back to the raw slug meanwhile.
  // Resolved against what this character holds, since a grant can be
  // conditional (Fine Meal cheers everyone but a noble) — promising a tag the
  // grant won't deliver would be worse than saying nothing.
  function consumeHintFor(tag) {
    const { slugs } = resolveConsumeGrants(tag, heldSlugs);
    const names = slugs.map((slug) => tagsBySlug.get(slug)?.name ?? slug);
    return names.length ? `Click to consume → ${names.join(", ")}` : "Click to consume";
  }

  return (
    <section className="panel p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h2 className="section-title">Tags</h2>
          {tagPoints != null && (
            <span className="text-sm">
              <span className="text-muted">Tag points </span>
              <TagPointsValue points={tagPoints} />
            </span>
          )}
        </div>
        {isSelf && (
          <TagRequestButtons
            catalog={catalog ?? []}
            characterTags={characterTags}
            resources={resources}
            otherCharacters={otherCharacters ?? []}
            selfId={selfId}
            canHeal={canHeal}
            healTargets={healTargets}
            healParties={healParties}
            onReady={onReady}
          />
        )}
      </div>
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
