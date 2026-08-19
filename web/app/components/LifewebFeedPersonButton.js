"use client";

import { useState } from "react";
import { useConfirm } from "./ConfirmProvider";
import { feedLifewebPerson } from "../(app)/lifeweb/actions";

export default function LifewebFeedPersonButton() {
  const confirm = useConfirm();
  const [pending, setPending] = useState(false);

  async function handleClick() {
    if (pending) return;
    const ok = await confirm({ title: "Feed a person to the Lifeweb?", confirmLabel: "Yes" });
    if (!ok) return;

    setPending(true);
    try {
      await feedLifewebPerson();
    } finally {
      setPending(false);
    }
  }

  return (
    <button type="button" className="btn" disabled={pending} onClick={handleClick}>
      Feed person
    </button>
  );
}
