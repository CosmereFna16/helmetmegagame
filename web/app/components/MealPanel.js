"use client";

import { useState } from "react";
import { ateMeal } from "../(app)/character/actions";

const NOBILITY_UNHAPPY_THRESHOLD_TURNS = 3;

export default function MealPanel({ characterId, hasNobility, lastFineMealTurn, openTurnNumber, skipNextMealConsumption }) {
  const [choosing, setChoosing] = useState(false);
  const [pending, setPending] = useState(false);

  const turnsSinceFineMeal =
    hasNobility && lastFineMealTurn != null && openTurnNumber != null
      ? openTurnNumber - lastFineMealTurn
      : null;
  const isOverdue = turnsSinceFineMeal != null && turnsSinceFineMeal >= NOBILITY_UNHAPPY_THRESHOLD_TURNS;

  async function handleChoice(choice) {
    if (pending) return;
    setPending(true);
    try {
      await ateMeal(characterId, choice);
      setChoosing(false);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="mt-4 flex flex-wrap items-center gap-3 border-t pt-4" style={{ borderColor: "var(--border)" }}>
      {choosing ? (
        <>
          <span className="text-sm">Fine or Lavish?</span>
          <button type="button" className="btn-quiet" disabled={pending} onClick={() => handleChoice("FINE")}>
            Fine
          </button>
          <button type="button" className="btn-quiet" disabled={pending} onClick={() => handleChoice("LAVISH")}>
            Lavish
          </button>
          <button type="button" className="btn-quiet" disabled={pending} onClick={() => setChoosing(false)}>
            Cancel
          </button>
        </>
      ) : (
        <>
          <button type="button" className="btn-quiet" disabled={pending} onClick={() => setChoosing(true)}>
            Ate Meal
          </button>
          {skipNextMealConsumption && (
            <span className="text-xs" style={{ color: "var(--muted)" }}>
              Next turn&rsquo;s resource cost is covered.
            </span>
          )}
        </>
      )}
      {hasNobility && (
        <span className="text-xs" style={{ color: isOverdue ? "var(--accent)" : "var(--muted)" }}>
          Turns since last fine meal: {turnsSinceFineMeal ?? "—"}
        </span>
      )}
    </div>
  );
}
