"use client";

import { useMemo, useState, useTransition } from "react";
import Modal from "@/app/components/Modal";
import FormError from "@/app/components/FormError";
import { mergeTagOp } from "@/lib/tagOpAlgebra";
import { createStagedEffects, updateStagedEffect } from "./actions";

// Stage a mechanical adjustment: signed ⬢ and/or tag adds/removes, against
// one target or many at once (the "Explosion Burns ×4 players" case — one
// batch, one tray line). Presence ops only; the Dev Panel keeps the full
// editor. Ops merge with the same algebra the Dev Panel uses, so add-then-
// remove cancels instead of stacking nonsense.
//
// With `existing` it edits one staged row instead (target fixed, batch
// membership dropped server-side).

const SEARCH_LIMIT = 12;

export default function EffectComposer({
  moveId = null,
  existing = null,
  defaultTarget = null,
  declaredDelta = null,
  roster,
  tagCatalog,
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
  const [targetSearch, setTargetSearch] = useState("");
  const [tagSearch, setTagSearch] = useState("");
  const [error, setError] = useState(null);
  const [pending, startTransition] = useTransition();

  const tagById = useMemo(() => new Map(tagCatalog.map((t) => [t.id, t])), [tagCatalog]);

  const targetMatches = useMemo(() => {
    const q = targetSearch.trim().toLowerCase();
    if (!q) return [];
    const chosen = new Set(targets.map((t) => t.id));
    return roster
      .filter((c) => !chosen.has(c.id) && c.name.toLowerCase().includes(q))
      .slice(0, SEARCH_LIMIT);
  }, [targetSearch, roster, targets]);

  const tagMatches = useMemo(() => {
    const q = tagSearch.trim().toLowerCase();
    if (!q) return [];
    return tagCatalog
      .filter((t) => t.name.toLowerCase().includes(q) || t.slug.includes(q))
      .slice(0, SEARCH_LIMIT);
  }, [tagSearch, tagCatalog]);

  function stageOp(tagId, op) {
    setOps((prev) => {
      const next = new Map(prev);
      const merged = mergeTagOp(next.get(tagId), { tagId, op, quantity: 1 });
      if (merged == null) next.delete(tagId);
      else next.set(tagId, merged);
      return next;
    });
  }

  function setQuantity(tagId, raw) {
    const quantity = Number.parseInt(raw, 10);
    setOps((prev) => {
      const next = new Map(prev);
      const op = next.get(tagId);
      if (op) next.set(tagId, { ...op, quantity: Number.isInteger(quantity) && quantity > 0 ? quantity : 1 });
      return next;
    });
  }

  function submit() {
    setError(null);
    startTransition(async () => {
      const tagOps = [...ops.values()];
      const res = existing
        ? await updateStagedEffect({ stagedEffectId: existing.id, resources, tagOps })
        : await createStagedEffects({
            targetCharacterIds: targets.map((t) => t.id),
            moveId,
            resources,
            tagOps,
          });
      if (!res?.ok) return setError(res?.error ?? "Something went wrong.");
      onDone();
    });
  }

  return (
    <Modal title={existing ? "Edit staged effect" : "Stage an effect"} onClose={() => !pending && onCancel()}>
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
                onClick={() => setTargets((prev) => prev.filter((p) => p.id !== t.id))}
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
                placeholder="Search characters…"
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
              onChange={(e) => setResources(e.target.value)}
              placeholder="±0"
            />
          </label>
          {declaredDelta != null && declaredDelta !== 0 && !existing && (
            <button
              type="button"
              className="btn-quiet"
              onClick={() => setResources(String(-declaredDelta))}
            >
              Offset declared ({declaredDelta > 0 ? "−" : "+"}
              {Math.abs(declaredDelta)})
            </button>
          )}
        </div>

        <div className="flex flex-col gap-2">
          <span className="field-label">Tag changes</span>
          {[...ops.values()].map((op) => {
            const tag = tagById.get(op.tagId);
            return (
              <div key={op.tagId} className="flex flex-wrap items-center gap-2 text-sm">
                <span className="mono">{op.op === "add" ? "+" : "−"}</span>
                <span>{tag?.name ?? "Unknown tag"}</span>
                {tag?.stackable && (
                  <input
                    type="number"
                    min="1"
                    className="desk-qty"
                    value={op.quantity ?? 1}
                    onChange={(e) => setQuantity(op.tagId, e.target.value)}
                    aria-label="Quantity"
                  />
                )}
                <button
                  type="button"
                  className="btn-quiet"
                  onClick={() =>
                    setOps((prev) => {
                      const next = new Map(prev);
                      next.delete(op.tagId);
                      return next;
                    })
                  }
                >
                  Unstage
                </button>
              </div>
            );
          })}
          <label className="field">
            <span className="field-label">Find a tag</span>
            <input value={tagSearch} onChange={(e) => setTagSearch(e.target.value)} placeholder="Search the catalog…" />
          </label>
          {tagMatches.length > 0 && (
            <div className="flex flex-col gap-1">
              {tagMatches.map((t) => (
                <div key={t.id} className="flex items-center justify-between gap-2 text-sm">
                  <span className="min-w-0 truncate">
                    {t.name}
                    {t.defaultDurationTurns ? (
                      <span className="text-muted"> · {t.defaultDurationTurns}t</span>
                    ) : null}
                  </span>
                  <span className="flex gap-1.5">
                    <button type="button" className="btn-quiet" onClick={() => stageOp(t.id, "add")}>
                      + Add
                    </button>
                    <button type="button" className="btn-quiet" onClick={() => stageOp(t.id, "remove")}>
                      − Remove
                    </button>
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        <FormError>{error}</FormError>

        <div className="modal-actions">
          <button type="button" className="btn-quiet" onClick={onCancel} disabled={pending}>
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
