"use client";

import { useState, useTransition } from "react";
import FormError from "@/app/components/FormError";
import EmptyState from "./EmptyState";
import InfoIcon from "./InfoIcon";
import RequestDialog from "./RequestDialog";
import RichText from "./RichText";
import DesireCatalog, { cooldownLabel } from "./DesireCatalog";
import { useConfirm } from "./ConfirmProvider";
import { cancelDesire, fulfillDesireRequest } from "../(app)/character/requestActions";

// The one help tooltip, on the heading. It used to be two — flavour text
// here and the rules behind a "How this works" line — and the flavour said
// nothing the catalog doesn't now say for itself.
function desireHelp(desireSlots) {
  return (
    <>
      <p>
        You have {desireSlots} Desire slot{desireSlots === 1 ? "" : "s"}.
      </p>
      <p>
        A Desire&apos;s tier is the Tag Points it pays. Every Desire also shows its cooldown: how
        many turns after you fulfil it before you can take it again. Usually that is its tier; a
        few are longer, and some can only ever be done once.
      </p>
      <p>
        Cancelling or fulfilling a Desire locks its slot for the rest of the turn and all of the
        next one. It opens again after.
      </p>
    </>
  );
}

// Body only — the panel chrome lives in GoalsPanel.js, which renders this.
// Renders `desireSlots` rows: filled, empty+free (opens the catalog),
// empty+cooling, or — if Desires are switched off entirely — the single
// "Temporarily disabled." line in place of every slot.
export default function DesirePanel({
  desireSlots = 2,
  slotStates = [],
  catalog = [],
  families = [],
  familyGroups = [],
  lockNotes = [],
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
        <InfoIcon text={desireHelp(desireSlots)} />
      </h3>

      {!desiresEnabled ? (
        <p className="text-sm text-muted">Temporarily disabled.</p>
      ) : (
        <div className="flex flex-col gap-3">
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
                    {/* RichText, not a bare string: Desire.text snapshots the
                        template name with its {tag:…} tokens intact, and out
                        here a token can be a real, hoverable chip. */}
                    <p className="text-sm">
                      <RichText text={slot.active.text} />
                    </p>
                    <p className="text-sm text-muted">
                      Worth {slot.active.points} Tag Point{slot.active.points === 1 ? "" : "s"}
                      {slot.active.setTurnNumber != null ? ` — set on turn ${slot.active.setTurnNumber}` : ""}
                      {cooldownLabel(slot.active.template)
                        ? ` · ${cooldownLabel(slot.active.template)} after`
                        : ""}
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

      {/* Keyed per opening so search, tab and target slot start fresh each
          time — the component asks for exactly that. */}
      <DesireCatalog
        key={catalogSlot ?? "closed"}
        open={catalogSlot != null}
        onClose={() => setCatalogSlot(null)}
        slotIndex={catalogSlot ?? 0}
        desireSlots={desireSlots}
        slotStates={slotStates}
        catalog={catalog}
        families={families}
        familyGroups={familyGroups}
        lockNotes={lockNotes}
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
          <RichText text={fulfilling?.text} /> — {fulfilling?.points} Tag Point
          {fulfilling?.points === 1 ? "" : "s"}
        </p>
        <p className="text-xs text-muted">
          You get the points immediately, but tell the GMs how you pulled it off.
        </p>
      </RequestDialog>
    </div>
  );
}
