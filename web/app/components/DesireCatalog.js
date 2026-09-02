"use client";

import { useMemo, useState, useTransition } from "react";
import Modal from "./Modal";
import FormError from "./FormError";
import StatusPill from "./StatusPill";
import { EmptyRow } from "./EmptyState";
import { useConfirm } from "./ConfirmProvider";
import { setDesire } from "../(app)/character/requestActions";

// The tiers a template can carry — same whitelist docs/desires.yaml
// validates against (tier 6 is deliberately absent).
const TIERS = [1, 2, 3, 4, 5, 7];

// Maps an evaluator state (db/lib/desireGates.js) to a StatusPill tone +
// label. "hidden" never reaches this component — evaluateDesireCatalog's
// `visible` array withholds it before character/page.js ever builds the
// payload (see character/page.js's desireCatalog projection).
function stateCell(entry) {
  switch (entry.state) {
    case "available":
      return { tone: "neutral", label: "Available" };
    case "active":
      return { tone: "accent", label: "Slotted" };
    case "cooldown":
      return {
        tone: "warn",
        label: entry.availableFromTurn != null ? `Cooldown — turn ${entry.availableFromTurn}` : "Cooldown",
      };
    case "locked":
      // Reason is the evaluator's own string, rendered verbatim — it never
      // names a hidden-category tag (db/lib/desireGates.js's evalRequires).
      return { tone: "muted", label: entry.reason ?? "Locked" };
    case "spent":
      return { tone: "muted", label: "Once only" };
    default:
      return { tone: "muted", label: entry.state };
  }
}

// The catalog browser: search + tier filter over the (already gate-evaluated,
// already hidden-filtered) `catalog` prop character/page.js hands down.
// Picking an available row sets it into `slotIndex` — confirm first, THEN
// the transition (DESIGN-SYSTEM.md §8): `confirm()` has to resolve on a
// click outside any startTransition scope, or the dialog never mounts.
export default function DesireCatalog({ open, onClose, slotIndex, catalog = [], families = [] }) {
  const confirm = useConfirm();
  const [query, setQuery] = useState("");
  const [tier, setTier] = useState(null);
  const [error, setError] = useState(null);
  const [pending, startTransition] = useTransition();

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return catalog.filter((entry) => {
      if (tier != null && entry.tier !== tier) return false;
      if (!q) return true;
      return (
        entry.name.toLowerCase().includes(q) || (entry.description ?? "").toLowerCase().includes(q)
      );
    });
  }, [catalog, query, tier]);

  // Grouped by family, in the header's declared order, with a final "Other"
  // bucket for a template that names no family (or one this catalog's own
  // families list doesn't carry). A template with more than one family
  // appears once under each — the whole point of browsing by family.
  const groups = useMemo(() => {
    const byKey = new Map(families.map((f) => [f.key, { family: f, entries: [] }]));
    const other = { family: { key: "__other", name: "Other" }, entries: [] };
    for (const entry of filtered) {
      const keys = (entry.families ?? []).filter((k) => byKey.has(k));
      if (keys.length === 0) {
        other.entries.push(entry);
        continue;
      }
      for (const key of keys) byKey.get(key).entries.push(entry);
    }
    return [...byKey.values(), other].filter((g) => g.entries.length > 0);
  }, [filtered, families]);

  async function chooseTemplate(slug) {
    setError(null);
    const ok = await confirm({
      title: "Set this Desire?",
      message: "Once set, cancelling or fulfilling it locks the slot until next turn.",
      confirmLabel: "Set Desire",
    });
    if (!ok) return;
    startTransition(async () => {
      const res = await setDesire({ slotIndex, slug });
      if (!res?.ok) return setError(res?.error ?? "Something went wrong.");
      onClose?.();
    });
  }

  return (
    <Modal open={open} title="Choose a Desire" onClose={() => !pending && onClose?.()} width="wide">
      <div className="mt-3 flex flex-col gap-3">
        <div className="flex flex-wrap items-end gap-3">
          <label className="field flex-1" style={{ minWidth: "14rem" }}>
            <span className="field-label">Search</span>
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Name or description…"
              data-autofocus
            />
          </label>
          <div className="field" style={{ maxWidth: "100%" }}>
            <span className="field-label">Tier</span>
            <div className="segmented" role="group" aria-label="Tier filter">
              <button type="button" onClick={() => setTier(null)} aria-pressed={tier == null}>
                All
              </button>
              {TIERS.map((t) => (
                <button key={t} type="button" onClick={() => setTier(t)} aria-pressed={tier === t}>
                  {t}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Tier</th>
                <th scope="col">State</th>
              </tr>
            </thead>
            <tbody>
              {groups.map(({ family, entries }) => (
                <FamilyGroup
                  key={family.key}
                  family={family}
                  entries={entries}
                  pending={pending}
                  onChoose={chooseTemplate}
                />
              ))}
              {groups.length === 0 && <EmptyRow cols={3}>Nothing matches.</EmptyRow>}
            </tbody>
          </table>
        </div>

        <FormError>{error}</FormError>
      </div>
    </Modal>
  );
}

function FamilyGroup({ family, entries, pending, onChoose }) {
  return (
    <>
      <tr>
        <td colSpan={3} className="text-xs text-muted font-semibold" style={{ paddingTop: "0.75rem" }}>
          {family.name}
        </td>
      </tr>
      {entries.map((entry) => {
        const { tone, label } = stateCell(entry);
        const clickable = entry.state === "available" && !pending;
        function activate() {
          if (clickable) onChoose(entry.slug);
        }
        function onKeyDown(e) {
          if (!clickable) return;
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            activate();
          }
        }
        return (
          <tr
            key={`${family.key}:${entry.slug}`}
            onClick={clickable ? activate : undefined}
            onKeyDown={clickable ? onKeyDown : undefined}
            tabIndex={clickable ? 0 : undefined}
            role={clickable ? "button" : undefined}
            aria-disabled={!clickable}
            style={{
              cursor: clickable ? "pointer" : undefined,
              opacity: entry.state === "available" ? 1 : 0.55,
            }}
          >
            <td>
              <div className="flex flex-col">
                <span>{entry.name}</span>
                {entry.description && <span className="text-xs text-muted">{entry.description}</span>}
              </div>
            </td>
            <td>
              <span className="chip">{entry.tier} pts</span>
            </td>
            <td>
              <StatusPill tone={tone}>{label}</StatusPill>
            </td>
          </tr>
        );
      })}
    </>
  );
}
