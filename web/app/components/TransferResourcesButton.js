"use client";

import { useState, useTransition } from "react";
import RequestDialog from "./RequestDialog";
import PartySelect from "./PartySelect";
import { transferResourcesRequest } from "../(app)/character/requestActions";

export default function TransferResourcesButton({ selfId, selfName, parties }) {
  const [open, setOpen] = useState(false);
  const [fromKey, setFromKey] = useState(`character:${selfId}`);
  const [toKey, setToKey] = useState("");
  const [amount, setAmount] = useState("1");
  const [error, setError] = useState(null);
  const [pending, startTransition] = useTransition();

  const sameParty = fromKey && fromKey === toKey;

  function submit(reason) {
    setError(null);
    startTransition(async () => {
      const res = await transferResourcesRequest({ fromKey, toKey, amount, reason });
      if (!res?.ok) return setError(res?.error ?? "Something went wrong.");
      setOpen(false);
    });
  }

  return (
    <>
      <button
        type="button"
        className="btn"
        onClick={() => {
          setFromKey(`character:${selfId}`);
          setToKey("");
          setAmount("1");
          setError(null);
          setOpen(true);
        }}
      >
        Transfer Resources
      </button>

      <RequestDialog
        open={open}
        title="Transfer Resources"
        submitLabel="Transfer"
        busy={pending}
        error={error}
        canSubmit={Boolean(fromKey && toKey && !sameParty)}
        onCancel={() => !pending && setOpen(false)}
        onConfirm={submit}
      >
        <div className="flex flex-wrap items-end gap-3">
          <PartySelect
            label="From"
            value={fromKey}
            onChange={setFromKey}
            hint="Choose a source…"
            characters={parties.characters}
            factions={parties.factions}
          />
          <PartySelect
            label="To"
            value={toKey}
            onChange={setToKey}
            hint="Choose a recipient…"
            characters={parties.characters}
            factions={parties.factions}
          />
          <label className="field" style={{ width: "6rem" }}>
            <span className="field-label">Amount</span>
            <input
              type="number"
              min="1"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              required
            />
          </label>
        </div>
        {sameParty && (
          <p className="text-xs text-accent">
            Source and recipient are the same.
          </p>
        )}
        <p className="text-xs text-muted">
          You can move resources out of any Silo or any player — say why in the reason above.
          {selfName ? ` You are ${selfName}.` : ""}
        </p>
      </RequestDialog>
    </>
  );
}
