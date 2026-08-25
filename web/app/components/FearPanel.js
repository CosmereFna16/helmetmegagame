"use client";

import FormError from "@/app/components/FormError";
import { useState, useTransition } from "react";
import { useConfirm } from "./ConfirmProvider";
import InfoIcon from "./InfoIcon";
import RequestDialog from "./RequestDialog";
import { FEAR_PENALTY, FEAR_MAX_LENGTH } from "@/lib/constants";
import { setWorstFear, changeWorstFearRequest, fulfillWorstFearRequest } from "../(app)/character/requestActions";

// Exported so the creation wizard's Fear step shows the same copy —
// two surfaces explaining one mechanic can't be allowed to drift.
export const FEAR_HELP = (
  <>
    <p>Your character has one Fear.</p>
    <p>
      When it comes true you lose {FEAR_PENALTY} Tag Points — always exactly that, however bad
      it was. It isn&apos;t a goal you complete; it&apos;s a dread you live with.
    </p>
    <p className="text-muted">
      Unlike Desires, you keep your Fear even after it gets triggered.
    </p>
  </>
);

// Two-way render, not three like Desire: the fear stays on screen during the
// cooldown, which only disables the button.
export default function FearPanel({ text, setTurnNumber, lastFulfilledTurn, openTurnNumber }) {
  const confirm = useConfirm();
  const [draft, setDraft] = useState("");
  const [changing, setChanging] = useState(false);
  const [fulfilling, setFulfilling] = useState(false);
  const [error, setError] = useState(null);
  const [pending, startTransition] = useTransition();

  // Mirrors the server check in fulfillWorstFearRequestImpl.
  const onCooldown =
    lastFulfilledTurn != null && openTurnNumber != null && openTurnNumber <= lastFulfilledTurn;

  async function submitFirst(e) {
    e.preventDefault();
    setError(null);
    const ok = await confirm({
      title: "Set this as your Fear?",
      message:
        "You only get one. Changing it later takes a request a GM reviews, so pick something you'll want to live with.",
      confirmLabel: "Set Fear",
    });
    if (!ok) return;
    startTransition(async () => {
      const res = await setWorstFear({ text: draft });
      if (!res?.ok) return setError(res?.error ?? "Something went wrong.");
      setDraft("");
    });
  }

  function submitChange(reason) {
    setError(null);
    startTransition(async () => {
      const res = await changeWorstFearRequest({ text: draft, reason });
      if (!res?.ok) return setError(res?.error ?? "Something went wrong.");
      setChanging(false);
      setDraft("");
    });
  }

  function submitFulfill(reason) {
    setError(null);
    startTransition(async () => {
      const res = await fulfillWorstFearRequest({ reason });
      if (!res?.ok) return setError(res?.error ?? "Something went wrong.");
      setFulfilling(false);
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <h3 className="field-label panel-header--with-icon">
        Fear
        <InfoIcon text={FEAR_HELP} />
      </h3>

      {text ? (
        <div className="flex flex-col gap-3">
          <p className="text-sm">{text}</p>
          <p className="text-sm text-muted">
            Costs {FEAR_PENALTY} Tag Points if it comes true
            {setTurnNumber != null ? ` — set on turn ${setTurnNumber}` : ""}
          </p>
          {onCooldown && (
            <p className="text-sm text-muted">
              It came true this turn — you can claim it again next turn.
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="btn-danger"
              onClick={() => setFulfilling(true)}
              disabled={pending || onCooldown}
            >
              It Came True
            </button>
            <button
              type="button"
              className="btn-quiet"
              onClick={() => {
                setDraft(text);
                setChanging(true);
              }}
              disabled={pending}
            >
              Change
            </button>
          </div>
        </div>
      ) : (
        <form className="flex flex-col gap-3" onSubmit={submitFirst}>
          <p className="text-sm text-muted">
            You haven&apos;t named one yet. Setting your first locks it, so ask a GM after if you need to change it.
          </p>
          <label className="field">
            <span className="field-label">What does your character dread?</span>
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              maxLength={FEAR_MAX_LENGTH}
              required
              placeholder="Dying alone! Well, your Tag Points won't matter then."
            />
          </label>
          <button type="submit" className="btn self-start" disabled={pending || !draft.trim()}>
            Set Fear
          </button>
        </form>
      )}

      <FormError>{error}</FormError>

      <RequestDialog
        open={fulfilling}
        title="Your Fear Came True"
        submitLabel="It Came True"
        busy={pending}
        onCancel={() => !pending && setFulfilling(false)}
        onConfirm={submitFulfill}
      >
        <p className="text-sm">{text}</p>
        <p className="text-sm text-accent">
          &minus;{FEAR_PENALTY} Tag Points, landing immediately.
        </p>
        <p className="text-xs text-muted">
          Tell the GMs how it happened.
        </p>
      </RequestDialog>

      <RequestDialog
        open={changing}
        title="Change Fear"
        submitLabel="Change It"
        busy={pending}
        canSubmit={Boolean(draft.trim()) && draft.trim() !== text}
        onCancel={() => !pending && setChanging(false)}
        onConfirm={submitChange}
      >
        <label className="field">
          <span className="field-label">Your new Fear</span>
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            maxLength={FEAR_MAX_LENGTH}
            required
          />
        </label>
        <p className="text-xs text-muted">
          This lands immediately. A GM can undo it, putting the old wording back.
        </p>
      </RequestDialog>
    </div>
  );
}
