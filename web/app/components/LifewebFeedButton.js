"use client";

import { useState } from "react";
import { feedLifewebBlood } from "../(app)/character/actions";

export default function LifewebFeedButton({ characterId }) {
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [fed, setFed] = useState(false);

  async function handleClick() {
    if (pending) return;
    if (!confirming) {
      setConfirming(true);
      return;
    }
    setPending(true);
    try {
      await feedLifewebBlood(characterId);
      setConfirming(false);
      setFed(true);
    } finally {
      setPending(false);
    }
  }

  if (fed) {
    return (
      <span className="text-xs" style={{ color: "var(--muted)" }}>
        Blood given. Something below took its due.
      </span>
    );
  }

  if (confirming) {
    return (
      <>
        <button type="button" className="btn-quiet" style={{ color: "var(--accent)" }} disabled={pending} onClick={handleClick}>
          Confirm — give your blood
        </button>
        <button type="button" className="btn-quiet" disabled={pending} onClick={() => setConfirming(false)}>
          Cancel
        </button>
      </>
    );
  }

  return (
    <button type="button" className="btn-quiet" disabled={pending} onClick={handleClick}>
      Feed the Lifeweb
    </button>
  );
}
