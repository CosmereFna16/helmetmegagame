"use client";

import { useState } from "react";
import { setDesire, completeDesire } from "../(app)/character/actions";
import { DESIRE_COOLDOWN_TURNS } from "@/lib/desire";

export default function DesirePanel({ characterId, desire, openTurnNumber, isSelf }) {
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [text, setText] = useState("");

  const isActive = desire?.status === "ACTIVE";
  const turnsSince =
    desire?.turnNumber != null && openTurnNumber != null ? openTurnNumber - desire.turnNumber : null;
  const turnsUntilEligible = !isActive && turnsSince != null ? Math.max(0, DESIRE_COOLDOWN_TURNS - turnsSince) : 0;
  const canSetNew = !isActive && turnsUntilEligible === 0;

  async function handleSet(e) {
    e.preventDefault();
    const trimmed = text.trim();
    if (!trimmed || pending) return;
    setPending(true);
    try {
      await setDesire(characterId, trimmed);
      setText("");
    } finally {
      setPending(false);
    }
  }

  async function handleCompleteClick() {
    if (pending) return;
    if (!confirming) {
      setConfirming(true);
      return;
    }
    setPending(true);
    try {
      await completeDesire(characterId, desire.id);
      setConfirming(false);
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="panel p-4">
      <h2 className="mb-2 font-bold">Desire</h2>
      {isActive ? (
        <>
          <p className="text-sm">{desire.description}</p>
          <p className="mt-1 text-xs" style={{ color: "var(--muted)" }}>
            {turnsSince != null ? `Set ${turnsSince} turn${turnsSince === 1 ? "" : "s"} ago` : "Just set"}
          </p>
          {isSelf && (
            <div className="mt-3 flex items-center gap-3">
              <button
                type="button"
                className="btn-quiet"
                style={confirming ? { color: "var(--accent)" } : undefined}
                disabled={pending}
                onClick={handleCompleteClick}
              >
                {confirming ? "Confirm" : "Complete Desire"}
              </button>
              {confirming && (
                <button type="button" className="btn-quiet" disabled={pending} onClick={() => setConfirming(false)}>
                  Cancel
                </button>
              )}
            </div>
          )}
        </>
      ) : (
        <>
          <p className="text-sm" style={{ color: "var(--muted)" }}>
            No active desire set.
          </p>
          {isSelf &&
            (canSetNew ? (
              <form onSubmit={handleSet} className="mt-3 flex flex-wrap items-end gap-3">
                <label className="field flex-1">
                  <span className="field-label">New desire</span>
                  <input value={text} onChange={(e) => setText(e.target.value)} required />
                </label>
                <button type="submit" className="btn" disabled={pending}>
                  Set Desire
                </button>
              </form>
            ) : (
              turnsUntilEligible > 0 && (
                <p className="mt-2 text-xs" style={{ color: "var(--muted)" }}>
                  You can set a new desire in {turnsUntilEligible} turn{turnsUntilEligible === 1 ? "" : "s"}.
                </p>
              )
            ))}
        </>
      )}
    </section>
  );
}
