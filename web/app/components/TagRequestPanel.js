"use client";

import { useState } from "react";
import { requestTagChanges } from "../(app)/character/actions";

export default function TagRequestPanel({ characterId }) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [sent, setSent] = useState(false);
  const [text, setText] = useState("");

  async function handleSubmit(e) {
    e.preventDefault();
    const trimmed = text.trim();
    if (!trimmed || pending) return;
    setPending(true);
    try {
      await requestTagChanges(characterId, trimmed);
      setText("");
      setOpen(false);
      setSent(true);
    } finally {
      setPending(false);
    }
  }

  if (!open) {
    return (
      <div className="mt-3 border-t pt-3" style={{ borderColor: "var(--border)" }}>
        <button type="button" className="btn-quiet" onClick={() => { setOpen(true); setSent(false); }}>
          Request Changes
        </button>
        {sent && (
          <p className="mt-1 text-xs" style={{ color: "var(--muted)" }}>
            Request submitted — awaiting GM review.
          </p>
        )}
      </div>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="mt-3 flex flex-col gap-2 border-t pt-3"
      style={{ borderColor: "var(--border)" }}
    >
      <label className="field">
        <span className="field-label">Describe the change you&apos;re requesting</span>
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={2} required />
      </label>
      <div className="flex items-center gap-3">
        <button type="submit" className="btn" disabled={pending}>
          Submit
        </button>
        <button type="button" className="btn-quiet" disabled={pending} onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </form>
  );
}
