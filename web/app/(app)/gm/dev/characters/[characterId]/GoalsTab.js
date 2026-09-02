"use client";

import FormError from "@/app/components/FormError";
import Select from "@/app/components/Select";
import { EnumPill, DESIRE_STATUS } from "@/app/components/StatusPill";
import { useMemo, useState, useTransition } from "react";
import { useConfirm } from "@/app/components/ConfirmProvider";
import { awardDesireGm, revokeDesireGm } from "./actions";

// The Desire half of the tag-point economy.
//
// This is a microaction rather than a staged field, because awarding a Desire
// moves tagPoints: staging a point movement alongside a hand-edited tagPoints
// value on the Identity tab would make the arithmetic ambiguous, so it commits
// on its own and the Identity field always shows the result.
//
// Per-slot, mirroring the player-facing DesirePanel/DesireCatalog. A Desire is
// claimed retroactively now (DESIRES.md §1), so a slot has no occupant to
// fulfil or cancel — each slot shows what it last paid out, whether it is
// cooling down, and an Award sub-form: a catalog picker (gates BYPASSED for a
// GM grant, retired templates included and marked) and the kept free-text
// fallback (1..7 points, wider than the player ladder). Taking one back is
// Revoke, on the row itself, down in Past desires.

const POINT_OPTIONS = [1, 2, 3, 4, 5, 6, 7];

function SlotForm({ slotIndex, catalog, families, pending, onAwardCatalog, onAwardFreeform }) {
  const [mode, setMode] = useState("catalog");
  const [slug, setSlug] = useState("");
  const [text, setText] = useState("");
  const [points, setPoints] = useState(3);

  const groups = useMemo(() => {
    const byKey = new Map(families.map((f) => [f.key, { family: f, entries: [] }]));
    const other = { family: { key: "__other", name: "Other" }, entries: [] };
    for (const entry of catalog) {
      const keys = (entry.families ?? []).filter((k) => byKey.has(k));
      if (keys.length === 0) {
        other.entries.push(entry);
        continue;
      }
      for (const key of keys) byKey.get(key).entries.push(entry);
    }
    return [...byKey.values(), other].filter((g) => g.entries.length > 0);
  }, [catalog, families]);

  return (
    <div className="flex flex-col gap-2 border-t border-hairline pt-3">
      <div className="segmented" role="group" aria-label="Desire source">
        <button type="button" onClick={() => setMode("catalog")} aria-pressed={mode === "catalog"}>
          Catalog
        </button>
        <button type="button" onClick={() => setMode("freeform")} aria-pressed={mode === "freeform"}>
          Free text
        </button>
      </div>

      {mode === "catalog" ? (
        <div className="flex flex-wrap items-end gap-2">
          <label className="field flex-1" style={{ minWidth: "14rem" }}>
            <span className="field-label">Template</span>
            <Select value={slug} onChange={(e) => setSlug(e.target.value)}>
              <option value="" disabled>
                Choose a Desire…
              </option>
              {groups.map(({ family, entries }) => (
                <optgroup key={family.key} label={family.name}>
                  {entries.map((entry) => (
                    <option key={entry.slug} value={entry.slug}>
                      {entry.name} ({entry.tier}){entry.retired ? " — retired" : ""}
                    </option>
                  ))}
                </optgroup>
              ))}
            </Select>
          </label>
          <button
            type="button"
            className="btn"
            disabled={pending || !slug}
            onClick={() => onAwardCatalog(slotIndex, slug, () => setSlug(""))}
          >
            Award
          </button>
        </div>
      ) : (
        <>
          <label className="field">
            <span className="field-label">Award a desire</span>
            <textarea rows={2} value={text} onChange={(e) => setText(e.target.value)} />
          </label>
          <div className="flex flex-wrap items-end gap-2">
            <label className="field">
              <span className="field-label">Worth</span>
              <Select value={points} onChange={(e) => setPoints(Number(e.target.value))}>
                {POINT_OPTIONS.map((n) => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </Select>
            </label>
            <button
              type="button"
              className="btn"
              disabled={pending || !text.trim()}
              onClick={() => onAwardFreeform(slotIndex, text, points, () => setText(""))}
            >
              Award
            </button>
          </div>
        </>
      )}
    </div>
  );
}

export default function GoalsTab({
  character,
  desires,
  desireSlots = 2,
  desireSlotStates = [],
  desireCatalog = [],
  desireFamilies = [],
  desireCooldowns = [],
}) {
  const confirm = useConfirm();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState(null);

  const bySlot = useMemo(
    () => new Map(desireSlotStates.map((s) => [s.slotIndex, s])),
    [desireSlotStates],
  );

  function run(fn) {
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if (!res?.ok) setError(res?.error ?? "Something went wrong.");
    });
  }

  // Confirm FIRST, transition SECOND — awaiting useConfirm() inside an async
  // transition scope defers the dialog's render behind a transition that is
  // waiting on the dialog, so it never appears and `pending` never clears.
  // See the note in ActionBar.js.
  async function confirmThenRun(opts, fn) {
    setError(null);
    if (!(await confirm(opts))) return;
    run(fn);
  }

  function awardCatalog(slotIndex, slug, onDone) {
    run(async () => {
      const res = await awardDesireGm({ characterId: character.id, slotIndex, slug });
      if (res?.ok) onDone();
      return res;
    });
  }

  function awardFreeform(slotIndex, text, points, onDone) {
    run(async () => {
      const res = await awardDesireGm({ characterId: character.id, slotIndex, text, points });
      if (res?.ok) onDone();
      return res;
    });
  }

  return (
    <>
      {Array.from({ length: desireSlots }, (_, slotIndex) => {
        const slot = bySlot.get(slotIndex) ?? { slotIndex, lockedUntilTurn: null, lastEnded: null };
        return (
          <section key={slotIndex} className="panel flex flex-col gap-3 p-4">
            <h2 className="panel-header">Desire — slot {slotIndex + 1}</h2>

            {slot.lastEnded ? (
              <>
                <p className="text-sm">» {slot.lastEnded.text}</p>
                <p className="text-sm text-muted mono">
                  paid {slot.lastEnded.points} ·{" "}
                  {slot.lockedUntilTurn != null
                    ? `slot opens turn ${slot.lockedUntilTurn}`
                    : "slot open"}
                </p>
              </>
            ) : (
              <p className="text-sm text-muted">
                {slot.lockedUntilTurn != null
                  ? `Slot opens on turn ${slot.lockedUntilTurn}.`
                  : "Nothing claimed in this slot yet."}
              </p>
            )}

            <SlotForm
              slotIndex={slotIndex}
              catalog={desireCatalog}
              families={desireFamilies}
              pending={pending}
              onAwardCatalog={awardCatalog}
              onAwardFreeform={awardFreeform}
            />
          </section>
        );
      })}

      {desireCooldowns.length > 0 && (
        <section className="panel flex flex-col gap-2 p-4">
          <h2 className="panel-header">Cooldowns</h2>
          <ul className="flex flex-col gap-1 text-sm">
            {desireCooldowns.map((c) => (
              <li key={c.slug} className="flex flex-wrap items-baseline gap-2">
                <span>{c.name} ({c.tier})</span>
                <span className="mono text-xs text-muted">
                  {c.state === "spent" ? "once only, spent" : `cooldown — turn ${c.availableFromTurn ?? "—"}`}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {desires.length > 0 && (
        <section className="panel flex flex-col gap-2 p-4">
          <h2 className="panel-header">Past desires</h2>
          <ul className="flex flex-col gap-1 text-sm">
            {desires.map((d) => (
              <li key={d.id} className="flex flex-wrap items-baseline gap-2">
                <EnumPill map={DESIRE_STATUS} value={d.status} />
                <span>{d.text}</span>
                <span className="mono text-xs text-muted">
                  slot {d.slotIndex + 1} · {d.points} pt · turn {d.endedTurnNumber ?? "—"}
                </span>
                {d.status !== "CANCELLED" && (
                  <button
                    type="button"
                    className="btn-quiet ml-auto"
                    disabled={pending}
                    onClick={() =>
                      confirmThenRun(
                        {
                          title: "Revoke this desire?",
                          message: `${character.name} loses ${d.points} tag point${d.points === 1 ? "" : "s"}, and the slot reopens.`,
                          confirmLabel: "Revoke",
                          cancelLabel: "Keep it",
                        },
                        () => revokeDesireGm({ characterId: character.id, desireId: d.id }),
                      )
                    }
                  >
                    Revoke
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <FormError>{error}</FormError>
    </>
  );
}
