"use client";

import { useState, useTransition } from "react";
import FormError from "@/app/components/FormError";
import EmptyState from "./EmptyState";
import InfoIcon from "./InfoIcon";
import RequestDialog from "./RequestDialog";
import RichText from "./RichText";
import DesireCatalog, { cooldownLabel } from "./DesireCatalog";
import { claimDesire } from "../(app)/character/requestActions";

// The one help tooltip, on the heading. It used to be two — flavour text
// here and the rules behind a "How this works" line — and the flavour said
// nothing the catalog doesn't now say for itself.
function desireHelp(desireSlots, lockTurns) {
  return (
    <>
      <p>
        You have {desireSlots} Desire slot{desireSlots === 1 ? "" : "s"}. After fulfilling a Desire,
        that slot is locked for {lockTurns} turn{lockTurns === 1 ? "" : "s"}.
      </p>
      <p>Addictions lock your bottom slot to everything except their related desires.</p>
      <p>
        Desires have tiers which determine the amount of points given. Low tier desires can be
        frequently repeated, while high tier desires are once per game.
      </p>
    </>
  );
}

// Body only — the panel chrome lives in GoalsPanel.js, which renders this.
//
// A Desire is claimed retroactively: you did the thing, then you come here and
// say so. So a slot is never "occupied" — it is either open (a Claim button) or
// cooling down from its last claim. Nothing to cancel, nothing in flight.
//
// The bottom slot draws a box around itself when an Addiction binds it, because
// the alternative — a picker that just silently has fewer rows in it — is the
// failure mode describeDesireLocks exists to prevent.
export default function DesirePanel({
  desireSlots = 2,
  slotLockTurns = 2,
  slotStates = [],
  catalog = [],
  families = [],
  familyGroups = [],
  lockNotes = [],
  addiction = null,
  desiresEnabled = true,
}) {
  const [error, setError] = useState(null);
  const [pending, startTransition] = useTransition();
  // Which slot opened the catalog modal, or null. A single shared modal
  // instance rather than one per slot — only one can be open at a time.
  const [catalogSlot, setCatalogSlot] = useState(null);
  // The pick waiting on a reason: { entry, slotIndex }, or null.
  const [claiming, setClaiming] = useState(null);

  const bySlot = new Map(slotStates.map((s) => [s.slotIndex, s]));
  const bottomIndex = desireSlots - 1;

  function submitClaim(reason) {
    setError(null);
    startTransition(async () => {
      const res = await claimDesire({
        slotIndex: claiming.slotIndex,
        slug: claiming.entry.slug,
        reason,
      });
      if (!res?.ok) return setError(res?.error ?? "Something went wrong.");
      setClaiming(null);
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <h3 className="field-label panel-header--with-icon">
        Desire
        <InfoIcon text={desireHelp(desireSlots, slotLockTurns)} />
      </h3>

      {!desiresEnabled ? (
        <p className="text-sm text-muted">Temporarily disabled.</p>
      ) : (
        <div className="flex flex-col gap-3">
          {Array.from({ length: desireSlots }, (_, slotIndex) => {
            const slot = bySlot.get(slotIndex) ?? { slotIndex, lockedUntilTurn: null, lastEnded: null };
            const bound = slotIndex === bottomIndex && addiction;
            return (
              <div
                key={slotIndex}
                className="flex flex-col gap-2"
                style={
                  slotIndex > 0 && !bound
                    ? { borderTop: "1px solid var(--border)", paddingTop: "0.75rem" }
                    : undefined
                }
              >
                <div
                  className="flex flex-col gap-2"
                  style={
                    bound
                      ? {
                          border: "1px solid var(--border)",
                          borderRadius: "var(--radius)",
                          padding: "0.75rem",
                        }
                      : undefined
                  }
                >
                  {slot.lastEnded && (
                    <p className="text-sm text-muted">
                      Last: <RichText text={slot.lastEnded.text} /> — {slot.lastEnded.points} Tag Point
                      {slot.lastEnded.points === 1 ? "" : "s"}
                      {cooldownLabel(slot.lastEnded.template)
                        ? ` · ${cooldownLabel(slot.lastEnded.template)}`
                        : ""}
                    </p>
                  )}
                  {slot.lockedUntilTurn != null ? (
                    <EmptyState>{`Opens on turn ${slot.lockedUntilTurn}`}</EmptyState>
                  ) : (
                    <button
                      type="button"
                      className="btn self-start"
                      onClick={() => setCatalogSlot(slotIndex)}
                    >
                      Claim a Desire
                    </button>
                  )}
                  {bound && (
                    <p className="text-xs text-muted">Addiction: {addiction.name}</p>
                  )}
                </div>
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
        onChoose={(pick) => {
          setCatalogSlot(null);
          setClaiming(pick);
        }}
        slotIndex={catalogSlot ?? 0}
        desireSlots={desireSlots}
        slotStates={slotStates}
        catalog={catalog}
        families={families}
        familyGroups={familyGroups}
        lockNotes={lockNotes}
        addiction={addiction}
      />

      <RequestDialog
        open={Boolean(claiming)}
        title="Claim Desire"
        submitLabel="Claim"
        busy={pending}
        onCancel={() => !pending && setClaiming(null)}
        onConfirm={submitClaim}
      >
        <p className="text-sm">
          <RichText text={claiming?.entry?.name} /> — {claiming?.entry?.tier} Tag Point
          {claiming?.entry?.tier === 1 ? "" : "s"}, into slot {(claiming?.slotIndex ?? 0) + 1}
        </p>
        <p className="text-xs text-muted">
          You get the points immediately, but tell the GMs how you pulled it off.
        </p>
      </RequestDialog>
    </div>
  );
}
