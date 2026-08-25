"use client";

import FormError from "@/app/components/FormError";
import { useState } from "react";
import { MAX_REASON_LENGTH } from "@/lib/constants";

import Modal from "./Modal";

// The universal Requests popup. Every player action that takes effect without
// GM approval opens one of these: a required reason on top (the thing the GM
// reads later), then whatever type-specific fields the caller passes as
// children. See docs/systemdocs/REQUESTS.md §2.
//
// Deliberately a rendered component taking children rather than a
// promise-returning hook like useConfirm() — the second half is arbitrary
// JSX per call site, which a hook API handles badly. It reuses the same
// .modal-overlay/.modal-panel styling so it matches every other modal.
// The shell only mounts its body while open, so the reason field resets
// between openings for free — no effect syncing state to the open flag.
export default function RequestDialog({ open, ...props }) {
  if (!open) return null;
  return <RequestDialogBody {...props} />;
}

function RequestDialogBody({
  title,
  submitLabel = "Confirm",
  busy = false,
  error = null,
  canSubmit = true,
  onCancel,
  onConfirm,
  children,
}) {
  const [reason, setReason] = useState("");

  const trimmed = reason.trim();
  const ready = !busy && canSubmit && trimmed.length > 0;

  return (
    <Modal title={title} onClose={() => !busy && onCancel?.()}>
      <form
        className="mt-3 flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (ready) onConfirm?.(trimmed);
        }}
      >
        <label className="field">
          <span className="field-label">What&apos;s your reason?</span>
          <textarea
            name="reason"
            rows={3}
            required
            autoFocus
            maxLength={MAX_REASON_LENGTH}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="This goes to the GMs — say what happened."
          />
        </label>
        <p className="text-xs text-muted" style={{ marginTop: "-0.25rem" }}>
          This takes effect immediately, but a GM can undo or edit it after.
        </p>

        {children && (
          <div className="flex flex-col gap-3 border-t pt-3" style={{ borderColor: "var(--border)" }}>
            {children}
          </div>
        )}

        <FormError>{error}</FormError>

        <div className="modal-actions">
          <button type="button" className="btn-quiet" onClick={() => onCancel?.()} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className="btn" disabled={!ready}>
            {busy ? "Working…" : submitLabel}
          </button>
        </div>
      </form>
    </Modal>
  );
}
