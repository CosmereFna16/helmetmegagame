"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { tagsById as buildTagsById } from "@/lib/characterCreation";
import { tagDuration, turnsLeft } from "@/lib/turnFormat";
import ChipLabel from "@/app/components/ChipLabel";
import QuantityField from "@/app/components/QuantityField";
import TagCatalogBrowser from "@/app/components/TagCatalogBrowser";
import CustomTagDialog from "@/app/components/CustomTagDialog";
import { useConfirm } from "@/app/components/ConfirmProvider";

// The GM's tag surface, sibling to the player's PointBuy store but bypassing
// every gate: all categories including hidden ones, no budget (tagPoints
// edits directly on Identity), and quantity/equipped/expiry all reachable.
//
// Everything here COMMITS ON THE GESTURE. Tag changes used to ride the panel's
// Apply bar, which meant adjusting one stack cost a stage, a scroll and an
// Apply — and Cancel then discarded every other pending edit with it. The core
// column edits (Identity/Turn/Goals) are still staged; tags are not. The
// adjudication desk's EffectComposer still stages, and still should: there the
// whole point is that nothing lands until the turn ends.
//
// A held stackable tag is edited by SETTING ITS COUNT, not by nudging it. The
// stepper reads the resulting quantity, so 7 -> 3 is one gesture rather than
// four clicks of "Take one". 0 means the whole holding goes.
export default function TagEditor({
  tags,
  held,
  openTurn,
  equipSlots,
  onApplyOps,
  characterId,
  characterName,
}) {
  // A tag just created through the door, shown immediately rather than
  // waiting on the router.refresh() CustomTagDialog already triggers.
  const [extraTags, setExtraTags] = useState([]);
  const [creating, setCreating] = useState(false);
  const [busyTagId, setBusyTagId] = useState(null);
  const [error, setError] = useState(null);
  const confirm = useConfirm();

  const allTags = useMemo(() => [...tags, ...extraTags], [tags, extraTags]);
  const tagsById = useMemo(() => buildTagsById(allTags), [allTags]);
  const tagsBySlug = useMemo(() => new Map(allTags.map((t) => [t.slug, t])), [allTags]);
  const categories = useMemo(
    () => [...new Set(allTags.map((t) => t.category))].sort((a, b) => a.localeCompare(b)),
    [allTags],
  );
  const heldTagIds = useMemo(() => new Set(held.map((h) => h.tagId)), [held]);
  const heldByTagId = useMemo(() => new Map(held.map((h) => [h.tagId, h])), [held]);
  const assignCharacters = characterId ? [{ id: characterId, name: characterName ?? "This character" }] : null;

  // One row's in-progress "how many to grant" for a tag not yet held. The
  // Holds section no longer needs a draft of its own: its stepper is bound to
  // the real quantity, and a change is sent rather than parked.
  const [catalogQtyDrafts, setCatalogQtyDrafts] = useState(() => new Map());

  function draftQty(tagId) {
    const n = Number.parseInt(catalogQtyDrafts.get(tagId) ?? "1", 10);
    return Number.isInteger(n) && n > 0 ? n : 1;
  }

  // One gesture, one call, one audit row, one DM. `ops` is an array because
  // Heal-all and Feed are single gestures carrying several ops, and
  // applyTagOpsInTx already applies a batch in the right order.
  const apply = useCallback(
    async (ops, { tagId = null } = {}) => {
      setError(null);
      setBusyTagId(tagId);
      try {
        const res = await onApplyOps(ops);
        if (!res?.ok) setError(res?.error ?? "Something went wrong. ‡");
        return res;
      } finally {
        setBusyTagId(null);
      }
    },
    [onApplyOps],
  );

  // What a removal would leave behind (Tag.removesInto, TAGS.md §5c). This is
  // the one gesture repeating its inverse does NOT undo — re-adding a Broken
  // Bone doesn't clear the Splinted the removal left — so it is the one that
  // still asks first now that nothing else does.
  function aftermathNames(tag) {
    const chain = tag?.removesInto;
    if (!Array.isArray(chain) || !chain.length) return [];
    const slugs = chain.flatMap((entry) =>
      typeof entry === "string" ? [entry] : Array.isArray(entry?.oneOf) ? entry.oneOf : [],
    );
    return [...new Set(slugs)].map((slug) => tagsBySlug.get(slug)?.name ?? slug);
  }

  async function removeHolding(tag, holding) {
    const leaves = aftermathNames(tag);
    if (leaves.length) {
      const list = leaves.length === 1 ? leaves[0] : `one of ${leaves.join(" or ")}`;
      const ok = await confirm({
        title: `Remove ${holding.name}? ‡`,
        message: `Removing it leaves ${list} behind, and putting it back will not clear that. ‡`,
        confirmLabel: "Remove it ‡",
        cancelLabel: "Keep it ‡",
      });
      if (!ok) return;
    }
    await apply([{ tagId: holding.tagId, op: "remove", quantity: null }], { tagId: holding.tagId });
  }

  // Mass add: one gesture granting every ticked tag, so still one audit row.
  function grantSelected(tagIds) {
    apply(tagIds.map((tagId) => ({ tagId, op: "add", quantity: 1 })));
  }

  // One line in the catalog. A tag already held is edited in Holds instead —
  // DEV-PANEL.md's own rule is that every action on an existing holding lives
  // there, and a Grant button here meant something quietly different from the
  // stepper sitting above it.
  function renderCatalogActions(tag, { held: isHeld }) {
    if (isHeld) {
      const holding = heldByTagId.get(tag.id);
      return (
        <span className="text-xs text-muted">
          held{holding?.quantity > 1 ? ` ×${holding.quantity}` : ""} — edit in Holds ‡
        </span>
      );
    }
    // Only a stackable tag gets a quantity at all. Everything else is a
    // holds-it-or-doesn't flag, and a GM surface doesn't get to override that
    // the way it overrides requiredTag and the budget (TAGS.md §5a).
    const qty = tag.stackable ? draftQty(tag.id) : 1;
    return (
      <>
        {tag.stackable && (
          <QuantityField
            inline
            ariaLabel="How many to grant ‡"
            value={catalogQtyDrafts.get(tag.id) ?? "1"}
            onChange={(v) => setCatalogQtyDrafts((prev) => new Map(prev).set(tag.id, v))}
          />
        )}
        <button
          type="button"
          className="btn-quiet"
          disabled={busyTagId === tag.id}
          onClick={() => apply([{ tagId: tag.id, op: "add", quantity: qty }], { tagId: tag.id })}
        >
          {qty > 1 ? `Grant ×${qty}` : "Grant"}
        </button>
      </>
    );
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

  return (
    <>
      <section className="panel flex flex-col gap-1 p-3">
        <h3 className="field-label">Holds ({heldSorted.length})</h3>
        {heldSorted.length === 0 && <p className="text-sm text-muted">Holds nothing yet. ‡</p>}
        <ul className="flex flex-col">
          {heldSorted.map((holding) => (
            <HeldRow
              key={holding.tagId}
              tag={tagsById.get(holding.tagId) ?? null}
              holding={holding}
              openTurn={openTurn}
              busy={busyTagId === holding.tagId}
              onSetQuantity={(n) =>
                apply([{ tagId: holding.tagId, op: "patch", quantity: n }], {
                  tagId: holding.tagId,
                })
              }
              onRemove={(tag) => removeHolding(tag, holding)}
              onPatch={(patch) =>
                apply([{ tagId: holding.tagId, op: "patch", ...patch }], {
                  tagId: holding.tagId,
                })
              }
            />
          ))}
        </ul>
        {error && (
          <span className="form-error text-xs" role="alert">
            {error}
          </span>
        )}
        <span className="text-xs text-muted">
          Equipment {equippedCount} / {equipSlots}. Changes here save straight away. GM grants
          ignore every requirement gate. ‡
        </span>
      </section>

      <TagCatalogBrowser
        tags={allTags}
        heldTagIds={heldTagIds}
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
//
// The stepper is bound to the RESULTING count, so it reads as "this character
// has N of these" rather than "add or take this many". A local draft rides on
// top of the real quantity purely so typing feels immediate; it is reconciled
// whenever the server's number changes underneath.
function HeldRow({ tag, holding, openTurn, busy, onSetQuantity, onRemove, onPatch }) {
  const left = turnsLeft(holding.expiresTurn, openTurn?.number);
  const stackable = Boolean(tag?.stackable);

  const [draft, setDraft] = useState(String(holding.quantity));
  // The committed number this draft was last reconciled against. Tracking it
  // in state and comparing during render is how a prop change is folded in
  // without an effect — react-hooks/set-state-in-effect is an error here.
  const [seen, setSeen] = useState(holding.quantity);
  if (seen !== holding.quantity) {
    setSeen(holding.quantity);
    setDraft(String(holding.quantity));
  }

  // Rapid +/- clicks coalesce into one write. Safe precisely because a patch
  // quantity is ABSOLUTE (db/lib/tagOps.js writes it straight onto the row):
  // dropping an intermediate value changes nothing about where it lands. A
  // stream of deltas could not be collapsed this way.
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);

  function commit(raw) {
    setDraft(raw);
    const n = Number.parseInt(String(raw).trim(), 10);
    if (!Number.isInteger(n) || n < 0) return;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      if (n === holding.quantity) return;
      // validateTagOps refuses a patch below 1 outright rather than degrading
      // to a removal, so zero has to become a remove op right here.
      if (n <= 0) onRemove(tag);
      else onSetQuantity(n);
    }, 400);
  }

  return (
    <li className="dev-tag-row" data-busy={busy || undefined}>
      <span className="flex flex-wrap items-baseline gap-2 flex-1 min-w-0">
        {/* `holding.name` is the snapshot name (what the character actually
            holds); `tag`, the live catalog row (absent if it's since fallen
            out of the catalog), supplies only the colour. */}
        <ChipLabel tag={{ name: holding.name, group: tag?.group ?? null }} />
        {!stackable && holding.quantity > 1 && (
          <span className="mono text-xs text-muted">×{holding.quantity}</span>
        )}
        <span className="text-xs text-muted mono">{holding.source}</span>
        {holding.equipped && <span className="chip">equipped</span>}
        {holding.expiresTurn != null && (
          <span className="text-xs text-muted">
            {/* tagDuration returns {label, badge} — TagChip destructures it. */}
            {tagDuration(left, tag?.defaultDurationTurns)?.label ?? ""}
          </span>
        )}
      </span>

      <span className="flex flex-wrap items-center gap-2">
        {stackable ? (
          <QuantityField
            inline
            min={0}
            ariaLabel={`How many ${holding.name} — 0 removes it ‡`}
            value={draft}
            onChange={commit}
            disabled={busy}
          />
        ) : (
          <button
            type="button"
            className="btn-quiet"
            disabled={busy}
            onClick={() => onRemove(tag)}
          >
            Remove
          </button>
        )}
        {tag?.equippable && (
          <button
            type="button"
            className="btn-quiet"
            disabled={busy}
            onClick={() => onPatch({ equipped: !holding.equipped })}
          >
            {holding.equipped ? "Unequip" : "Equip"}
          </button>
        )}
        {tag?.defaultDurationTurns != null && holding.expiresTurn != null && (
          <button
            type="button"
            className="btn-quiet"
            disabled={busy}
            onClick={() => onPatch({ expiry: { mode: "never" } })}
          >
            Make permanent
          </button>
        )}
      </span>
    </li>
  );
}
