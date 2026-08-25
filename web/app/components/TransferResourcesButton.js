"use client";

import { useState, useTransition } from "react";
import RequestDialog from "./RequestDialog";
import InfoIcon from "./InfoIcon";
import PartySelect from "./PartySelect";
import { transferResourcesRequest } from "../(app)/character/requestActions";

// Mirrors web/lib/transferReach.js, which is the gate that actually decides.
// Kept short on purpose — the tooltip is 280px wide — and phrased as what the
// player must DO rather than as the rule's mechanics.
const REACH_HINT = (
  <>
    <p>The source and the recipient have to be in the same place.</p>
    <p>
      <strong>To a person</strong> Be in the same location.
    </p>
    <p>
      <strong>To or from a Silo</strong> Be in the faction&apos;s zone — or in the same zone as one
      of its Leaders or Treasurers.
    </p>
    <p>
      That way, someone can trade in the name of a faction, or send a tax tithe.
    </p>
  </>
);

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
      <div className="flex items-center gap-2">
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
        <InfoIcon text={REACH_HINT} />
      </div>

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
          {/* Was "out of any Silo or any player", which is exactly what the
              reach gate stopped being true — see web/lib/transferReach.js. */}
          Both the source and the recipient have to share: the same location for a person, the same zone (or an officer&apos;s zone) for a Silo. Say why in the reason above.
          {selfName ? ` You are ${selfName}.` : ""}
        </p>
      </RequestDialog>
    </>
  );
}
