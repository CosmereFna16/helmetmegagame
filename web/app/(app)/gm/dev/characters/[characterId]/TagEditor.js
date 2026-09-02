"use client";

import { useMemo, useState } from "react";
import { tagsById as buildTagsById } from "@/lib/characterCreation";
import { tagDuration, turnsLeft } from "@/lib/turnFormat";
import ChipLabel from "@/app/components/ChipLabel";
import TagCatalogBrowser from "@/app/components/TagCatalogBrowser";
import CustomTagDialog from "@/app/components/CustomTagDialog";

// The GM's tag surface, sibling to the player's PointBuy store but bypassing
// every gate: all categories including hidden ones, no budget (tagPoints
// edits directly on Identity), and quantity/equipped/expiry all reachable.
// Everything here STAGES — nothing writes until Apply. Held section up top
// (full actions on what's actually held), catalog below grouped by TagGroup;
// a held tag also appears in the catalog (to grant a second copy) but only
// carries not-yet-held actions, so nothing is staged from two places.
// `characterId`/`characterName` preselect the custom-tag door's "Assign to";
// both optional.
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
    () =>
      new Map(
        [...ops.entries()].map(([tagId, op]) => [
          tagId,
          op.op === "add" && op.quantity > 1 ? `add ×${op.quantity}` : op.op,
        ]),
      ),
    [ops],
  );
  const assignCharacters = characterId ? [{ id: characterId, name: characterName ?? "This character" }] : null;

  // One row's in-progress "how many" — a plain Map keyed by tagId, read at
  // render time so a click always stages whatever is currently typed. Draft
  // text rather than a number so an empty box doesn't snap back to 1 mid-edit.
  const [catalogQtyDrafts, setCatalogQtyDrafts] = useState(() => new Map());
  const [heldQtyDrafts, setHeldQtyDrafts] = useState(() => new Map());

  function draftQty(drafts, tagId) {
    const raw = drafts.get(tagId);
    const n = Number.parseInt(raw ?? "1", 10);
    return Number.isInteger(n) && n > 0 ? n : 1;
  }

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

  // Mass add: stage one `add` op per ticked tag in a single gesture.
  function grantSelected(tagIds) {
    onStage(tagIds.map((tagId) => ({ tagId, op: "add", quantity: 1 })));
  }

  // One line in the catalog. Held tags still show up (to grant a second copy
  // or higher tier) but carry only Grant plus Unstage — every action on an
  // existing holding lives in the Held section above instead.
  function renderCatalogActions(tag, { staged }) {
    // Only a stackable tag gets a quantity at all. Everything else is a
    // holds-it-or-doesn't flag, and a GM surface doesn't get to override that
    // the way it overrides requiredTag and the budget (TAGS.md §5a).
    const qty = tag.stackable ? draftQty(catalogQtyDrafts, tag.id) : 1;
    return (
      <>
        {tag.stackable && (
          <input
            type="number"
            min="1"
            className="desk-qty"
            value={catalogQtyDrafts.get(tag.id) ?? "1"}
            onChange={(e) =>
              setCatalogQtyDrafts((prev) => new Map(prev).set(tag.id, e.target.value))
            }
            aria-label="Quantity"
          />
        )}
        <button
          type="button"
          className="btn-quiet"
          onClick={() => onStage([{ tagId: tag.id, op: "add", quantity: qty }])}
        >
          {qty > 1 ? `Grant ×${qty}` : "Grant"}
        </button>
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
              qtyDraft={heldQtyDrafts.get(holding.tagId)}
              onQtyDraftChange={(value) =>
                setHeldQtyDrafts((prev) => new Map(prev).set(holding.tagId, value))
              }
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

// One line in the Holds section — every action on an existing holding lives
// here. `tag` is the catalog row (for stackable/equippable/
// defaultDurationTurns/group); null if it's fallen out of the fetched catalog.
function HeldRow({ tag, holding, op, openTurn, onStage, qtyDraft, onQtyDraftChange }) {
  const staged = op?.op ?? null;
  const left = turnsLeft(holding.expiresTurn, openTurn?.number);
  const qtyN = Number.parseInt(qtyDraft ?? "1", 10);
  const qty = tag?.stackable && Number.isInteger(qtyN) && qtyN > 0 ? qtyN : 1;

  return (
    <li
      className={`dev-tag-row${staged ? " staged-row" : ""}`}
      data-staged={staged ?? undefined}
    >
      <span className="flex flex-wrap items-baseline gap-2 flex-1 min-w-0">
        {/* `holding.name` is the snapshot name (what the character actually
            holds); `tag`, the live catalog row (absent if it's since fallen
            out of the catalog), supplies only the colour. */}
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
            staged: {staged === "add" && op.quantity > 1 ? `add ×${op.quantity}` : staged}
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
          <input
            type="number"
            min="1"
            className="desk-qty"
            value={qtyDraft ?? "1"}
            onChange={(e) => onQtyDraftChange(e.target.value)}
            aria-label="Quantity"
          />
        )}
        <button
          type="button"
          className="btn-quiet"
          onClick={() => onStage([{ tagId: holding.tagId, op: "add", quantity: qty }])}
        >
          {qty > 1 ? `Add ×${qty}` : "Add one"}
        </button>
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
