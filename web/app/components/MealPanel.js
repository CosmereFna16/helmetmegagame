"use client";

import { useState } from "react";
import { ateMeal, drinkAlcohol } from "../(app)/character/actions";

const NOBILITY_UNHAPPY_THRESHOLD_TURNS = 3;

export default function MealPanel({
  characterId,
  resources,
  hasNobility,
  lastFineMealTurn,
  openTurnNumber,
  skipNextMealConsumption,
  tipsyExpiresTurn,
  alcoholCost,
}) {
  const [choosingMeal, setChoosingMeal] = useState(false);
  const [confirmingAlcohol, setConfirmingAlcohol] = useState(false);
  const [pending, setPending] = useState(false);

  const turnsSinceFineMeal =
    hasNobility && lastFineMealTurn != null && openTurnNumber != null
      ? openTurnNumber - lastFineMealTurn
      : null;
  const isOverdue = turnsSinceFineMeal != null && turnsSinceFineMeal >= NOBILITY_UNHAPPY_THRESHOLD_TURNS;

  const tipsyTurnsLeft =
    tipsyExpiresTurn != null && openTurnNumber != null ? tipsyExpiresTurn - openTurnNumber : null;
  const isTipsy = tipsyTurnsLeft != null && tipsyTurnsLeft > 0;
  const canAffordAlcohol = resources >= alcoholCost;

  async function handleMealChoice(choice) {
    if (pending) return;
    setPending(true);
    try {
      await ateMeal(characterId, choice);
      setChoosingMeal(false);
    } finally {
      setPending(false);
    }
  }

  async function handleAlcoholClick() {
    if (pending) return;
    if (!confirmingAlcohol) {
      setConfirmingAlcohol(true);
      return;
    }
    setPending(true);
    try {
      await drinkAlcohol(characterId);
      setConfirmingAlcohol(false);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="mt-4 flex flex-wrap items-center gap-3 border-t pt-4" style={{ borderColor: "var(--border)" }}>
      {choosingMeal ? (
        <>
          <span className="text-sm">Fine or Lavish?</span>
          <button type="button" className="btn-quiet" disabled={pending} onClick={() => handleMealChoice("FINE")}>
            Fine
          </button>
          <button type="button" className="btn-quiet" disabled={pending} onClick={() => handleMealChoice("LAVISH")}>
            Lavish
          </button>
          <button type="button" className="btn-quiet" disabled={pending} onClick={() => setChoosingMeal(false)}>
            Cancel
          </button>
        </>
      ) : (
        <button type="button" className="btn-quiet" disabled={pending} onClick={() => setChoosingMeal(true)}>
          Ate Meal
        </button>
      )}

      {confirmingAlcohol ? (
        <>
          <button
            type="button"
            className="btn-quiet"
            style={{ color: "var(--accent)" }}
            disabled={pending}
            onClick={handleAlcoholClick}
          >
            Confirm (-{alcoholCost} ⬢)
          </button>
          <button type="button" className="btn-quiet" disabled={pending} onClick={() => setConfirmingAlcohol(false)}>
            Cancel
          </button>
        </>
      ) : (
        <button
          type="button"
          className="btn-quiet"
          disabled={pending || !canAffordAlcohol}
          title={canAffordAlcohol ? undefined : `Needs ${alcoholCost} resources`}
          onClick={handleAlcoholClick}
        >
          Take Alcohol
        </button>
      )}

      {skipNextMealConsumption && (
        <span className="tag-hover" tabIndex={0}>
          <span aria-hidden="true">🍴</span>
          <span className="tag-tooltip" role="tooltip">
            Ate meal — won&rsquo;t go hungry next turn
          </span>
        </span>
      )}

      {isTipsy && (
        <span className="tag-hover" tabIndex={0}>
          <span aria-hidden="true">🍷</span>
          <span className="tag-tooltip" role="tooltip">
            <strong>Tipsy</strong>
            <p>Immune to Unhappy, slightly worse at combat.</p>
            {tipsyTurnsLeft} turn{tipsyTurnsLeft === 1 ? "" : "s"} left
          </span>
        </span>
      )}

      {hasNobility && (
        <span className="text-xs" style={{ color: isOverdue ? "var(--accent)" : "var(--muted)" }}>
          Turns since last fine meal: {turnsSinceFineMeal ?? "—"}
        </span>
      )}
    </div>
  );
}
