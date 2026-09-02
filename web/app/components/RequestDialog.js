"use client";

import FormError from "@/app/components/FormError";
import { useState } from "react";
import { MAX_REASON_LENGTH } from "@/lib/constants";

import Modal from "./Modal";

// The universal Requests popup. Every player action that takes effect without
// GM approval opens one of these: a required reason on top, then whatever
// type-specific fields the caller passes as children. See
// docs/systemdocs/REQUESTS.md §2. `reasonRequired={false}` drops the reason
// box for a Request whose own fields already are the evidence a GM reads.
// The shell only mounts its body while open, so the reason field resets
// between openings for free.
export default function RequestDialog({ open, ...props }) {
  if (!open) return null;
  return <RequestDialogBody {...props} />;
}

function RequestDialogBody({
  title,
  submitLabel = "Confirm",
  // Forwarded to Modal's own narrow/wide/widest sizes. A dialog whose body is
  // a browsable tag catalog needs the room; the ordinary two-field ones don't.
  width = undefined,
  busy = false,
  error = null,
  canSubmit = true,
  reasonRequired = true,
  onCancel,
  onConfirm,
  children,
}) {
  const [reason, setReason] = useState("");

  const trimmed = reason.trim();
  const ready = !busy && canSubmit && (!reasonRequired || trimmed.length > 0);

  return (
    <Modal title={title} width={width} onClose={() => !busy && onCancel?.()}>
      <form
        className="mt-3 flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (ready) onConfirm?.(trimmed);
        }}
      >
        {reasonRequired && (
          <>
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
                placeholder="The GMs will see this."
              />
            </label>
            <p className="text-xs text-muted" style={{ marginTop: "-0.25rem" }}>
              This takes effect immediately, but a GM can undo or edit it after.
            </p>
          </>
        )}

        {children && (
          // The rule divides the reason from the type-specific fields. With no
          // reason above it there is nothing to divide, so it goes too.
          <div
            className={`flex flex-col gap-3${reasonRequired ? " border-t pt-3" : ""}`}
            style={reasonRequired ? { borderColor: "var(--border)" } : undefined}
          >
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
