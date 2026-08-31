"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import Modal from "@/app/components/Modal";
import FormError from "@/app/components/FormError";
import Select from "@/app/components/Select";
import useDirtyGuard from "@/app/components/useDirtyGuard";
import { mergeTagOp } from "@/lib/tagOpAlgebra";
import { scoreMatch } from "@/lib/fuzzySearch";
import TagChip from "@/app/components/TagChip";
import TagCatalogBrowser from "@/app/components/TagCatalogBrowser";
import CustomTagDialog from "@/app/components/CustomTagDialog";
import { createStagedEffects, updateStagedEffect, getHeldTags } from "./actions";
import { mutationErrorMessage } from "@/app/components/useDeskVersion";

// Stage a mechanical adjustment: signed ⬢ and/or tag adds/removes, against
// one target or many at once (the "Explosion Burns ×4 players" case — one
// batch, one tray line). Presence ops only; the Dev Panel keeps the full
// editor. Ops merge with the same algebra the Dev Panel uses, so add-then-
// remove cancels instead of stacking nonsense.
//
// With `existing` it edits one staged row instead (target fixed, batch
// membership dropped server-side).
//
// Tag selection uses the same power-user catalog browser as the Dev Panel's
// TagEditor (categories, description search, group/chain sort, multi-select)
// via the shared TagCatalogBrowser — this is where most mid-turn effect
// changes actually happen, so it gets the full surface, not a shortcut.

const SEARCH_LIMIT = 12;

export default function EffectComposer({
  moveId = null,
  cavingRollId = null,
  existing = null,
  defaultTarget = null,
  declaredDelta = null,
  roster,
  tagCatalog,
  presenceZones = [],
  onDone,
  onCancel,
}) {
  const [targets, setTargets] = useState(() => {
    if (existing) return [{ id: existing.targetCharacterId, name: existing.targetName }];
    return defaultTarget ? [defaultTarget] : [];
  });
  const [resources, setResources] = useState(() => {
    const v = existing?.resources ?? 0;
    return v ? String(v) : "";
  });
  const [ops, setOps] = useState(() => {
    const map = new Map();
    for (const op of existing?.tagOps ?? []) map.set(op.tagId, op);
    return map;
  });
  const [tagPoints, setTagPoints] = useState(() => {
    const v = existing?.tagPoints ?? 0;
    return v ? String(v) : "";
  });
  const [zoneId, setZoneId] = useState(() => existing?.zoneId ?? "");
  const [targetSearch, setTargetSearch] = useState("");
  const [error, setError] = useState(null);
  const [pending, startTransition] = useTransition();
  const { markDirty, markClean, guardedClose } = useDirtyGuard();

  // Tags ticked in the catalog browser but not yet folded into `ops` — a GM
  // who checks boxes and presses "Stage it" directly (skipping "Add N
  // selected") still gets them, via `submit()` below. Lifted out of
  // TagCatalogBrowser, which otherwise owns this as purely internal state.
  const [checkedTagIds, setCheckedTagIds] = useState(() => new Set());

  // A quantity box's in-progress text, kept separate from the committed
  // `op.quantity` so Backspace-then-retype doesn't snap to 1 mid-edit
  // (Number.parseInt("") is NaN, which the old code coerced immediately).
  // Committed on blur by commitQuantity.
  const [quantityDrafts, setQuantityDrafts] = useState(() => new Map());

  // "Add cancelled the staged Remove" (or vice versa) — set by stageOp when
  // mergeTagOp returns null and the row silently disappears from "Tag
  // changes"; otherwise that has no explanation at all.
  const [cancelNotice, setCancelNotice] = useState(null);

  // Held-tags cache, one entry per character seen so far — cheap to keep for
  // the life of the modal, since a target is rarely un-picked and re-picked.
  // Only a successful fetch is cached; a failure is never stored as "[]",
  // which used to be indistinguishable from a character who truly holds
  // nothing (see the effect below).
  const [heldByCharacter, setHeldByCharacter] = useState(() => new Map());
  const [heldFetchFailed, setHeldFetchFailed] = useState(false);
  const [heldFetchRetry, setHeldFetchRetry] = useState(0);

  // A tag just created through the custom-tag door, shown immediately rather
  // than waiting on the router.refresh() CustomTagDialog already triggers.
  const [extraTags, setExtraTags] = useState([]);
  const [creatingTag, setCreatingTag] = useState(false);

  const allTagCatalog = useMemo(() => [...tagCatalog, ...extraTags], [tagCatalog, extraTags]);
  const tagById = useMemo(() => new Map(allTagCatalog.map((t) => [t.id, t])), [allTagCatalog]);
  const tagCategories = useMemo(
    () => [...new Set(allTagCatalog.map((t) => t.category))].sort((a, b) => a.localeCompare(b)),
    [allTagCatalog],
  );

  // Only meaningful with exactly one target — a batch stage has no single
  // "their tags" to show.
  const soleTargetId = targets.length === 1 ? targets[0].id : null;
  const heldEntry = soleTargetId ? (heldByCharacter.get(soleTargetId) ?? null) : null;

  useEffect(() => {
    if (!soleTargetId || heldEntry) return undefined;
    let cancelled = false;
    (async () => {
      setHeldFetchFailed(false);
      const res = await getHeldTags({ characterId: soleTargetId });
      if (cancelled) return;
      if (!res?.ok) {
        setHeldFetchFailed(true);
        return;
      }
      setHeldByCharacter((prev) => (prev.has(soleTargetId) ? prev : new Map(prev).set(soleTargetId, res.tags)));
    })();
    return () => {
      cancelled = true;
    };
  }, [soleTargetId, heldEntry, heldFetchRetry]);

  const heldTagIds = useMemo(() => new Set((heldEntry ?? []).map((t) => t.tagId)), [heldEntry]);

  const targetMatches = useMemo(() => {
    const q = targetSearch.trim();
    if (!q) return [];
    const chosen = new Set(targets.map((t) => t.id));
    return roster
      .filter((c) => !chosen.has(c.id))
      .map((c) => ({
        c,
        match: scoreMatch(q, { name: c.name, role: c.roleTitle, faction: c.factionName, zone: c.zoneName, username: c.username }),
      }))
      .filter((r) => r.match)
      .sort((a, b) => b.match.score - a.match.score)
      .slice(0, SEARCH_LIMIT)
      .map((r) => r.c);
  }, [targetSearch, roster, targets]);

  const stagedByTagId = useMemo(
    () => new Map([...ops.entries()].map(([tagId, op]) => [tagId, op.op])),
    [ops],
  );

  function stageOp(tagId, op) {
    // `cancelledName` is computed OUT HERE, not read inside the functional
    // updater below — React may invoke that updater twice, and the notice is
    // a side effect (same discipline QueueRail's own key handler follows).
    let cancelledName = null;
    setOps((prev) => {
      const next = new Map(prev);
      const merged = mergeTagOp(next.get(tagId), { tagId, op, quantity: 1 });
      if (merged == null) {
        next.delete(tagId);
        cancelledName = tagById.get(tagId)?.name ?? "that tag";
      } else {
        next.set(tagId, merged);
      }
      return next;
    });
    setCancelNotice(
      cancelledName ? `${cancelledName}: the new op exactly cancelled what was already staged, so nothing is staged for it now.` : null,
    );
    markDirty();
  }

  function commitQuantity(tagId, raw) {
    const trimmed = raw.trim();
    setOps((prev) => {
      const next = new Map(prev);
      const op = next.get(tagId);
      if (!op) return prev;
      let quantity;
      if (trimmed === "") {
        // Blanking the box means "the whole holding" — the same null the Dev
        // Panel's own Remove uses (lib/tagOpAlgebra.js).
        quantity = null;
      } else {
        const parsed = Number.parseInt(trimmed, 10);
        quantity = Number.isInteger(parsed) && parsed > 0 ? parsed : op.quantity;
      }
      next.set(tagId, { ...op, quantity });
      return next;
    });
    setQuantityDrafts((prev) => {
      const next = new Map(prev);
      next.delete(tagId);
      return next;
    });
  }

  function stageManyAdds(tagIds) {
    for (const tagId of tagIds) stageOp(tagId, "add");
    setCheckedTagIds(new Set());
  }

  function renderTagBrowserActions(tag, { held: isHeld, staged }) {
    return (
      <>
        <button type="button" className="btn-quiet" onClick={() => stageOp(tag.id, "add")}>
          + Add
        </button>
        {(!soleTargetId || isHeld) && (
          <button type="button" className="btn-quiet" onClick={() => stageOp(tag.id, "remove")}>
            − Remove
          </button>
        )}
        {staged && (
          <button
            type="button"
            className="btn-quiet"
            onClick={() => {
              setOps((prev) => {
                const next = new Map(prev);
                next.delete(tag.id);
                return next;
              });
              markDirty();
            }}
          >
            Unstage
          </button>
        )}
      </>
    );
  }

  function submit() {
    setError(null);
    startTransition(async () => {
      try {
        // Fold in any tags still ticked in the catalog browser but never
        // folded into `ops` via "Add N selected" — checking a box should be
        // enough, without also pressing a second button.
        let tagOps = [...ops.values()];
        if (checkedTagIds.size) {
          const merged = new Map(ops);
          for (const tagId of checkedTagIds) {
            const next = mergeTagOp(merged.get(tagId), { tagId, op: "add", quantity: 1 });
            if (next == null) merged.delete(tagId);
            else merged.set(tagId, next);
          }
          tagOps = [...merged.values()];
        }
        const res = existing
          ? await updateStagedEffect({ stagedEffectId: existing.id, resources, tagPoints, tagOps, zoneId })
          : await createStagedEffects({
              targetCharacterIds: targets.map((t) => t.id),
              moveId,
              cavingRollId,
              resources,
              tagPoints,
              tagOps,
              zoneId,
            });
        if (!res?.ok) return setError(res?.error ?? "Something went wrong.");
        markClean();
        onDone();
      } catch {
        setError(mutationErrorMessage());
      }
    });
  }

  return (
    <Modal
      title={existing ? "Edit staged effect" : "Stage an effect"}
      onClose={() => !pending && guardedClose(onCancel)}
      width="widest"
    >
      <div className="mt-3 flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <span className="field-label">Targets</span>
          <div className="flex flex-wrap gap-1.5">
            {targets.map((t) => (
              <button
                key={t.id}
                type="button"
                className="chip"
                disabled={Boolean(existing)}
                onClick={() => {
                  setTargets((prev) => prev.filter((p) => p.id !== t.id));
                  markDirty();
                }}
                title={existing ? undefined : "Remove target"}
              >
                {t.name}
                {!existing && " ✕"}
              </button>
            ))}
            {!targets.length && <span className="text-sm text-muted">nobody yet</span>}
          </div>
          {!existing && (
            <label className="field">
              <span className="field-label">Add a target</span>
              <input
                value={targetSearch}
                onChange={(e) => setTargetSearch(e.target.value)}
                placeholder="name, role, faction, zone…"
              />
            </label>
          )}
          {targetMatches.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {targetMatches.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className="chip"
                  onClick={() => {
                    setTargets((prev) => [...prev, { id: c.id, name: c.name }]);
                    setTargetSearch("");
                    markDirty();
                  }}
                >
                  + {c.name}
                  {c.factionName ? <span className="text-muted"> · {c.factionName}</span> : null}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <label className="field" style={{ width: "10rem" }}>
            <span className="field-label">Resources</span>
            <input
              type="number"
              value={resources}
              onChange={(e) => {
                setResources(e.target.value);
                markDirty();
              }}
              onWheel={(e) => e.currentTarget.blur()}
              placeholder="±0"
            />
          </label>
          <label className="field" style={{ width: "10rem" }}>
            <span className="field-label">Tag points</span>
            <input
              type="number"
              value={tagPoints}
              onChange={(e) => {
                setTagPoints(e.target.value);
                markDirty();
              }}
              onWheel={(e) => e.currentTarget.blur()}
              placeholder="±0"
            />
          </label>
          <label className="field" style={{ width: "12rem" }}>
            <span className="field-label">Relocate to</span>
            <Select
              value={zoneId}
              onChange={(e) => {
                setZoneId(e.target.value);
                markDirty();
              }}
            >
              <option value="">— no move —</option>
              {presenceZones.map((z) => (
                <option key={z.id} value={z.id}>
                  {z.name}
                </option>
              ))}
            </Select>
          </label>
          {declaredDelta != null && declaredDelta !== 0 && !existing && (
            <button
              type="button"
              className="btn-quiet"
              onClick={() => {
                setResources(String(-declaredDelta));
                markDirty();
              }}
            >
              Offset declared ({declaredDelta > 0 ? "−" : "+"}
              {Math.abs(declaredDelta)})
            </button>
          )}
        </div>

        <div className="flex flex-col gap-2">
          <span className="field-label">Tag changes</span>
          {cancelNotice && <p className="text-xs text-muted">{cancelNotice}</p>}
          {[...ops.values()].map((op) => {
            const tag = tagById.get(op.tagId);
            return (
              <div key={op.tagId} className="flex flex-wrap items-center gap-2 text-sm">
                <span className="mono">{op.op === "add" ? "+" : "−"}</span>
                {tag ? <TagChip tag={tag} /> : <span>Unknown tag</span>}
                {tag?.stackable && (
                  <input
                    type="number"
                    min="1"
                    className="desk-qty"
                    value={quantityDrafts.has(op.tagId) ? quantityDrafts.get(op.tagId) : (op.quantity ?? "")}
                    placeholder={op.quantity == null ? "all" : undefined}
                    onChange={(e) => {
                      setQuantityDrafts((prev) => new Map(prev).set(op.tagId, e.target.value));
                      markDirty();
                    }}
                    onBlur={(e) => commitQuantity(op.tagId, e.target.value)}
                    aria-label="Quantity — blank means the whole holding"
                  />
                )}
                <button
                  type="button"
                  className="btn-quiet"
                  onClick={() => {
                    setOps((prev) => {
                      const next = new Map(prev);
                      next.delete(op.tagId);
                      return next;
                    });
                    setCancelNotice(null);
                    markDirty();
                  }}
                >
                  Unstage
                </button>
              </div>
            );
          })}
          {soleTargetId && (
            <div className="flex flex-col gap-1">
              <span className="field-label">Their tags</span>
              {heldFetchFailed ? (
                <span className="text-sm text-accent flex items-center gap-2">
                  Couldn&apos;t load their tags.
                  <button
                    type="button"
                    className="btn-quiet"
                    onClick={() => setHeldFetchRetry((n) => n + 1)}
                  >
                    Retry
                  </button>
                </span>
              ) : !heldEntry ? (
                <span className="text-sm text-muted">Loading their tags…</span>
              ) : heldEntry.length === 0 ? (
                <span className="text-sm text-muted">They hold nothing.</span>
              ) : (
                heldEntry.map((t) => {
                  const staged = ops.get(t.tagId);
                  // The held list comes back with only id/name/quantity (see
                  // getHeldTags), not the full catalog row — fall back to the
                  // catalog copy (tagById) so the chip can show its colour and
                  // tooltip; a tag dropped from the catalog since it was
                  // granted just reads as plain text.
                  const catalogTag = tagById.get(t.tagId);
                  return (
                    <div key={t.tagId} className="flex items-center justify-between gap-2 text-sm">
                      <span className="min-w-0 truncate">
                        {catalogTag ? (
                          <TagChip tag={catalogTag} quantity={t.quantity} />
                        ) : (
                          <>
                            {t.name}
                            {t.quantity > 1 ? ` ×${t.quantity}` : ""}
                          </>
                        )}
                      </span>
                      <button
                        type="button"
                        className="btn-quiet"
                        disabled={staged?.op === "remove"}
                        onClick={() => stageOp(t.tagId, "remove")}
                      >
                        {staged?.op === "remove" ? "Staged" : "− Remove"}
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          )}
          <TagCatalogBrowser
            tags={allTagCatalog}
            heldTagIds={heldTagIds}
            stagedByTagId={stagedByTagId}
            selectable
            selected={checkedTagIds}
            onSelectedChange={(next) => {
              setCheckedTagIds(next);
              markDirty();
            }}
            onSelectAction={stageManyAdds}
            selectActionLabel="Add"
            renderActions={renderTagBrowserActions}
            onCreateCustom={() => setCreatingTag(true)}
          />
        </div>

        {creatingTag && (
          <CustomTagDialog
            categories={tagCategories}
            tags={allTagCatalog}
            characters={targets}
            defaultAssignIds={targets.map((t) => t.id)}
            mode="stage"
            allowStage
            onClose={() => setCreatingTag(false)}
            onCreated={(tag, { assignedIds, staged } = {}) => {
              // A staged assignment already wrote its own StagedEffect row
              // server-side (see createCustomTagAndAssign) — it does NOT go
              // into this composer's own `ops`, which would double it up the
              // next time "Stage it" is pressed. An "apply now" assignment
              // is a live grant, same story. Either way the new tag just
              // needs to be visible in the browser and pickable from here on.
              setExtraTags((prev) => [...prev, tag]);
              setCreatingTag(false);
              // An "apply now" grant changed a target's actual held tags —
              // drop the cached "Their tags" entry so the next render
              // refetches instead of showing the pre-grant snapshot.
              if (!staged && assignedIds?.length) {
                setHeldByCharacter((prev) => {
                  const next = new Map(prev);
                  for (const id of assignedIds) next.delete(id);
                  return next;
                });
              }
            }}
          />
        )}

        <FormError>{error}</FormError>

        <div className="modal-actions">
          <button type="button" className="btn-quiet" onClick={() => guardedClose(onCancel)} disabled={pending}>
            Cancel
          </button>
          <button type="button" className="btn" onClick={submit} disabled={pending}>
            {pending ? "Working…" : existing ? "Save" : "Stage it"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
