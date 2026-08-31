"use client";

import { useMemo, useState } from "react";
import { tagsById as buildTagsById } from "@/lib/characterCreation";
import { tagDuration, turnsLeft } from "@/lib/turnFormat";
import ChipLabel from "@/app/components/ChipLabel";
import TagCatalogBrowser from "@/app/components/TagCatalogBrowser";
import CustomTagDialog from "@/app/components/CustomTagDialog";

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
// `characterId`/`characterName` feed the custom-tag door's "Assign to" —
// this character, preselected, so a GM inventing a one-off tag mid-sheet can
// grant it in the same gesture. Both are optional: a caller that doesn't
// pass them still gets the door, just without the assign-to preselection —
// the tag lands in the catalog and a plain Grant does the rest.
export default function TagEditor({ tags, held, ops, openTurn, equipSlots, onStage, characterId, characterName }) {
  // A tag just created through the door, shown immediately rather than
  // waiting on the router.refresh() CustomTagDialog already triggers.
  const [extraTags, setExtraTags] = useState([]);
  const [creating, setCreating] = useState(false);

  const allTags = useMemo(() => [...tags, ...extraTags], [tags, extraTags]);
  const tagsById = useMemo(() => buildTagsById(allTags), [allTags]);
  const categories = useMemo(
    () => [...new Set(allTags.map((t) => t.category))].sort((a, b) => a.localeCompare(b)),
    [allTags],
  );
  const heldTagIds = useMemo(() => new Set(held.map((h) => h.tagId)), [held]);
  const stagedByTagId = useMemo(
    () => new Map([...ops.entries()].map(([tagId, op]) => [tagId, op.op])),
    [ops],
  );
  const assignCharacters = characterId ? [{ id: characterId, name: characterName ?? "This character" }] : null;

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

  // Mass add: stage one `add` op per ticked tag in a single gesture, which is
  // the whole point — granting a starting loadout one dropdown at a time was
  // the old editor's worst habit.
  function grantSelected(tagIds) {
    onStage(tagIds.map((tagId) => ({ tagId, op: "add", quantity: 1 })));
  }

  // One line in the catalog. Held tags still show up (that's how a GM finds
  // a second copy or a higher tier of a chain they already hold) but carry
  // only the not-yet-held action (Grant) plus Unstage — every action on an
  // EXISTING holding lives in the Held section above, so a stage can't be
  // pushed from two different rows for the same tag.
  function renderCatalogActions(tag, { held: isHeld, staged }) {
    return (
      <>
        {!isHeld && (
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
      </>
    );
  }

  return (
    <>
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
        <span className="text-xs text-muted">
          Equipment {equippedCount} / {equipSlots}. GM grants ignore every requirement gate.
        </span>
      </section>

      <TagCatalogBrowser
        tags={allTags}
        heldTagIds={heldTagIds}
        stagedByTagId={stagedByTagId}
        selectable
        onSelectAction={grantSelected}
        selectActionLabel="Grant"
        renderActions={renderCatalogActions}
        onCreateCustom={() => setCreating(true)}
      />

      {creating && (
        <CustomTagDialog
          categories={categories}
          tags={allTags}
          characters={assignCharacters}
          defaultAssignIds={characterId ? [characterId] : []}
          mode="apply"
          onClose={() => setCreating(false)}
          onCreated={(tag) => {
            setExtraTags((prev) => [...prev, tag]);
            setCreating(false);
          }}
        />
      )}
    </>
  );
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
      className={`dev-tag-row${staged ? " staged-row" : ""}`}
      data-staged={staged ?? undefined}
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
          <span className="text-xs text-accent">
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
