"use client";

import { useState, useTransition } from "react";
import FormError from "@/app/components/FormError";
import EmptyState from "./EmptyState";
import InfoIcon from "./InfoIcon";
import RequestDialog from "./RequestDialog";
import DesireCatalog from "./DesireCatalog";
import { useConfirm } from "./ConfirmProvider";
import { cancelDesire, fulfillDesireRequest } from "../(app)/character/requestActions";

const DESIRE_HELP = (
  <>
    <p>
      You can fulfill Desires to obtain more tag points. Desires must be difficult and personal
      to receive points. For the Baron, even a whole bottle of gin is hardly satisfactory; for
      the Peasant, one glass is enough.
    </p>
    <p className="text-muted">
      Leaders can set desires according to their faction goals, but to encourage conflict and
      roleplay, most people should have more personalized, individual goals.
    </p>
  </>
);

// Rewritten for the catalog rework — the old free-text 1-5 point ladder is
// gone. ‡ marks every rewritten line (docs/desires.yaml's own convention).
function pointsHelp(desireSlots) {
  return (
    <>
      <p>
        You have {desireSlots} Desire slot{desireSlots === 1 ? "" : "s"}.‡
      </p>
      <p>
        Desires have tiers, which determine the amount of points given and, in most cases, how many
        turns until that same Desire is available again.‡
      </p>
      <p>
        Cancelling or fulfilling a Desire locks its slot for the rest of the turn and all of the
        next one. It opens again after.
      </p>
      <p>Tier 7 Desires can only be fulfilled once per game.‡</p>
    </>
  );
}

// Body only — the panel chrome lives in GoalsPanel.js, which renders this.
// Renders `desireSlots` rows: filled, empty+free (opens the catalog),
// empty+cooling, or — if Desires are switched off entirely — the single
// "Temporary disabled." line in place of every slot.
export default function DesirePanel({
  desireSlots = 2,
  slotStates = [],
  catalog = [],
  families = [],
  desiresEnabled = true,
}) {
  const confirm = useConfirm();
  const [error, setError] = useState(null);
  const [pending, startTransition] = useTransition();
  // Which slot opened the catalog modal, or null. A single shared modal
  // instance rather than one per slot — only one can be open at a time.
  const [catalogSlot, setCatalogSlot] = useState(null);
  // The Desire row currently in the Fulfill dialog, or null.
  const [fulfilling, setFulfilling] = useState(null);

  const bySlot = new Map(slotStates.map((s) => [s.slotIndex, s]));

  async function onCancel(slotIndex) {
    setError(null);
    const ok = await confirm({
      title: "Cancel this Desire?",
      message:
        "That slot stays shut for the rest of this turn and all of the next one, and no points are awarded.",
      confirmLabel: "Cancel Desire",
      cancelLabel: "Keep it",
    });
    if (!ok) return;
    startTransition(async () => {
      const res = await cancelDesire({ slotIndex });
      if (!res?.ok) setError(res?.error ?? "Something went wrong.");
    });
  }

  function submitFulfill(reason) {
    setError(null);
    startTransition(async () => {
      const res = await fulfillDesireRequest({ desireId: fulfilling.id, reason });
      if (!res?.ok) return setError(res?.error ?? "Something went wrong.");
      setFulfilling(null);
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <h3 className="field-label panel-header--with-icon">
        Desire
        <InfoIcon text={DESIRE_HELP} />
      </h3>

      {!desiresEnabled ? (
        <p className="text-sm text-muted">Temporary disabled.</p>
      ) : (
        <div className="flex flex-col gap-3">
          <span className="text-xs text-muted flex items-center gap-1.5">
            How this works
            <InfoIcon text={pointsHelp(desireSlots)} />
          </span>

          {Array.from({ length: desireSlots }, (_, slotIndex) => {
            const slot = bySlot.get(slotIndex) ?? { slotIndex, active: null, lockedUntilTurn: null };
            return (
              <div
                key={slotIndex}
                className="flex flex-col gap-2"
                style={
                  slotIndex > 0
                    ? { borderTop: "1px solid var(--border)", paddingTop: "0.75rem" }
                    : undefined
                }
              >
                {slot.active ? (
                  <>
                    <p className="text-sm">{slot.active.text}</p>
                    <p className="text-sm text-muted">
                      Worth {slot.active.points} Tag Point{slot.active.points === 1 ? "" : "s"}
                      {slot.active.setTurnNumber != null ? ` — set on turn ${slot.active.setTurnNumber}` : ""}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        className="btn"
                        onClick={() => setFulfilling(slot.active)}
                        disabled={pending}
                      >
                        Fulfill
                      </button>
                      <button
                        type="button"
                        className="btn-quiet"
                        onClick={() => onCancel(slotIndex)}
                        disabled={pending}
                      >
                        Cancel
                      </button>
                    </div>
                  </>
                ) : slot.lockedUntilTurn != null ? (
                  <EmptyState>{`Opens on turn ${slot.lockedUntilTurn}`}</EmptyState>
                ) : (
                  <button type="button" className="btn self-start" onClick={() => setCatalogSlot(slotIndex)}>
                    Choose a Desire
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      <FormError>{error}</FormError>

      <DesireCatalog
        open={catalogSlot != null}
        onClose={() => setCatalogSlot(null)}
        slotIndex={catalogSlot ?? 0}
        catalog={catalog}
        families={families}
      />

      <RequestDialog
        open={Boolean(fulfilling)}
        title="Fulfill Desire"
        submitLabel="Fulfill"
        busy={pending}
        onCancel={() => !pending && setFulfilling(null)}
        onConfirm={submitFulfill}
      >
        <p className="text-sm">
          {fulfilling?.text} — {fulfilling?.points} Tag Point{fulfilling?.points === 1 ? "" : "s"}
        </p>
        <p className="text-xs text-muted">
          You get the points immediately, but tell the GMs how you pulled it off.
        </p>
      </RequestDialog>
    </div>
  );
}
