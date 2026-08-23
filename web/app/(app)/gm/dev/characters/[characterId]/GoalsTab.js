"use client";

import { EnumPill, DESIRE_STATUS } from "@/app/components/StatusPill";
import { useState, useTransition } from "react";
import { useConfirm } from "@/app/components/ConfirmProvider";
import { setDesireGm, endDesireGm, fulfillWorstFearGm } from "./actions";

// Desires and the Worst Fear — the two halves of the tag-point economy.
//
// These are microactions rather than staged fields, because both move
// tagPoints: fulfilling a Desire credits its points, fulfilling a Worst Fear
// debits a flat 3. Staging a point movement alongside a hand-edited tagPoints
// value on the Identity tab would make the arithmetic ambiguous, so they
// commit on their own and the Identity field always shows the result.
const WORST_FEAR_COST = 3;

export default function GoalsTab({ character, staged, desires, openTurn, onField }) {
  const confirm = useConfirm();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState(null);
  const [text, setText] = useState("");
  const [points, setPoints] = useState(3);

  const active = desires.find((d) => d.status === "ACTIVE") ?? null;
  const past = desires.filter((d) => d.status !== "ACTIVE");

  // The one-turn cooldown: the stamp is what drives it, so show it plainly
  // rather than making a GM work it out.
  const fearOnCooldown =
    character.worstFearLastFulfilledTurn != null &&
    openTurn != null &&
    character.worstFearLastFulfilledTurn >= openTurn.number;

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

  return (
    <>
      <section className="panel flex flex-col gap-3 p-4">
        <h2 className="panel-header">Desire</h2>

        {active ? (
          <>
            <p className="text-sm">» {active.text}</p>
            <p className="text-sm text-muted mono">
              worth {active.points} · set turn {active.setTurnNumber ?? "—"}
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="btn"
                disabled={pending}
                onClick={() =>
                  confirmThenRun(
                    {
                      title: "Fulfil this desire?",
                      message: `${character.name} gains ${active.points} tag point${active.points === 1 ? "" : "s"}.`,
                      confirmLabel: "Fulfil",
                    },
                    () => endDesireGm({ characterId: character.id, desireId: active.id, mode: "fulfill" }),
                  )
                }
              >
                Fulfil (+{active.points})
              </button>
              <button
                type="button"
                className="btn-quiet"
                disabled={pending}
                onClick={() =>
                  confirmThenRun(
                    {
                      title: "Cancel this desire?",
                      message: "It ends with no points awarded.",
                      confirmLabel: "Cancel it",
                      cancelLabel: "Keep it",
                    },
                    () => endDesireGm({ characterId: character.id, desireId: active.id, mode: "cancel" }),
                  )
                }
              >
                Cancel
              </button>
            </div>
          </>
        ) : (
          <p className="text-sm text-muted">No active desire.</p>
        )}

        <div className="flex flex-col gap-2 border-t pt-3" style={{ borderColor: "var(--border)" }}>
          <label className="field">
            <span className="field-label">
              {active ? "Replace with a new desire (cancels the current one)" : "Set a desire"}
            </span>
            <textarea rows={2} value={text} onChange={(e) => setText(e.target.value)} />
          </label>
          <div className="flex flex-wrap items-end gap-2">
            <label className="field">
              <span className="field-label">Worth</span>
              <select value={points} onChange={(e) => setPoints(Number(e.target.value))}>
                {[1, 2, 3, 4, 5].map((n) => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="btn"
              disabled={pending || !text.trim()}
              onClick={() =>
                run(async () => {
                  const res = await setDesireGm({ characterId: character.id, text, points });
                  if (res?.ok) setText("");
                  return res;
                })
              }
            >
              Set desire
            </button>
          </div>
        </div>
      </section>

      <section className="panel flex flex-col gap-3 p-4">
        <h2 className="panel-header">Worst Fear</h2>
        <label className="field">
          <span className="field-label">Worst fear (staged — commits with Apply)</span>
          <textarea
            rows={2}
            value={staged.worstFear ?? ""}
            onChange={(e) => onField("worstFear", e.target.value)}
          />
        </label>
        <p className="text-sm text-muted mono">
          set turn {character.worstFearSetTurnNumber ?? "—"} · last fulfilled{" "}
          {character.worstFearLastFulfilledTurn ?? "never"}
        </p>
        <button
          type="button"
          className="btn self-start"
          disabled={pending || !character.worstFear || fearOnCooldown}
          onClick={() =>
            confirmThenRun(
              {
                title: "Fulfil their worst fear?",
                message: `${character.name} loses ${WORST_FEAR_COST} tag points, and can't have it fulfilled again until next turn.`,
                confirmLabel: "Fulfil",
              },
              () => fulfillWorstFearGm({ characterId: character.id }),
            )
          }
        >
          {fearOnCooldown ? "Already fulfilled this turn" : `Fulfil (−${WORST_FEAR_COST})`}
        </button>
      </section>

      {past.length > 0 && (
        <section className="panel flex flex-col gap-2 p-4">
          <h2 className="panel-header">Past desires</h2>
          <ul className="flex flex-col gap-1 text-sm">
            {past.map((d) => (
              <li key={d.id} className="flex flex-wrap items-baseline gap-2">
                <EnumPill map={DESIRE_STATUS} value={d.status} />
                <span>{d.text}</span>
                <span className="mono text-xs text-muted">
                  {d.points} pt · turn {d.endedTurnNumber ?? "—"}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {error && <p className="text-sm text-accent">{error}</p>}
    </>
  );
}
