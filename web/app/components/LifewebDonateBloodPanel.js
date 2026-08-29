"use client";

import { useState } from "react";
import { useConfirm } from "./ConfirmProvider";
import Select from "./Select";
import { donateBlood } from "../(app)/lifeweb/actions";

export default function LifewebDonateBloodPanel({ characters }) {
  const confirm = useConfirm();
  const [characterId, setCharacterId] = useState("");
  const [pending, setPending] = useState(false);

  async function handleClick() {
    if (!characterId || pending) return;
    const character = characters.find((c) => c.id === characterId);
    const ok = await confirm({
      title: "Donate blood?",
      message: character ? `Grants ${character.name} the Drained tag and adds blood to the Lifeweb.` : "",
      confirmLabel: "Yes",
    });
    if (!ok) return;

    setPending(true);
    try {
      await donateBlood(characterId);
      setCharacterId("");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-wrap items-end gap-2">
      <label className="field">
        <span className="field-label">Player</span>
        <Select value={characterId} onChange={(e) => setCharacterId(e.target.value)}>
          <option value="" disabled>
            Choose a player...
          </option>
          {characters.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
      </label>
      <button type="button" className="btn" disabled={!characterId || pending} onClick={handleClick}>
        Donate blood
      </button>
    </div>
  );
}
