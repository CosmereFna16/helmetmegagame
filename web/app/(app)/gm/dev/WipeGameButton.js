"use client";

import FormError from "@/app/components/FormError";
import { useState, useTransition } from "react";
import { wipeGameData } from "./actions";

// Restart Game's confirm/error wrapper — same reasons EndTurnButton.js exists
// for End Turn: a pending server action blocks client-side navigation, and
// wipeGameData now returns { ok, error } rather than throwing into a
// non-existent error.js, so something has to render the error. Typing "WIPE"
// in the field below is already the confirmation step, so this deliberately
// doesn't stack a useConfirm() dialog on top of it.
export default function WipeGameButton() {
  const [confirmText, setConfirmText] = useState("");
  const [error, setError] = useState(null);
  const [pending, startTransition] = useTransition();

  function onSubmit(e) {
    e.preventDefault();
    const formData = new FormData(e.target);

    setError(null);
    startTransition(async () => {
      // wipeGameData catches its own failures, but a transport error can
      // reject before that try block even runs — same reasoning as
      // EndTurnButton.js's onClick.
      try {
        const res = await wipeGameData(formData);
        if (!res?.ok) setError(res?.error ?? "Something went wrong.");
      } catch {
        setError("Could not reach the server. Nothing was changed.");
      }
    });
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-2">
      <div className="flex flex-wrap items-end gap-3">
        <label className="field">
          <span className="field-label">Type WIPE to confirm</span>
          <input
            type="text"
            name="confirm"
            autoComplete="off"
            style={{ width: "10rem" }}
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
          />
        </label>
        <button type="submit" className="btn" style={{ borderColor: "var(--accent)" }} disabled={pending}>
          {pending ? "Wiping…" : "Wipe & restart game"}
        </button>
      </div>
      <FormError>{error}</FormError>
    </form>
  );
}
