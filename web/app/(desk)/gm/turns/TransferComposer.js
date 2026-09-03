"use client";

import { useMemo, useState, useTransition } from "react";
import Modal from "@/app/components/Modal";
import FormError from "@/app/components/FormError";
import Select from "@/app/components/Select";
import useDirtyGuard from "@/app/components/useDirtyGuard";
import { createStagedTransfer } from "./actions";
import { mutationErrorMessage } from "@/app/components/useDeskVersion";

// Stage a character-to-character ⬢ transfer. 1:1 by nature, so it's its own
// composer rather than another field bolted onto the multi-target one.
export default function TransferComposer({ roster, defaultFromKey = "", onDone, onCancel }) {
  const [fromKey, setFromKey] = useState(defaultFromKey);
  const [toKey, setToKey] = useState("");
  const [amount, setAmount] = useState("");
  const [error, setError] = useState(null);
  const [pending, startTransition] = useTransition();
  const { markDirty, markClean, guardedClose } = useDirtyGuard();

  const parties = useMemo(
    () => ({
      characters: roster.map((c) => ({ key: `character:${c.id}`, label: c.name })),
    }),
    [roster],
  );

  function partyOptions() {
    return (
      <>
        <option value="">— pick one —</option>
        <optgroup label="Characters">
          {parties.characters.map((p) => (
            <option key={p.key} value={p.key}>
              {p.label}
            </option>
          ))}
        </optgroup>
      </>
    );
  }

  const amountValid = Number.isInteger(Number.parseInt(amount, 10)) && Number(amount) > 0;

  function submit() {
    setError(null);
    if (!fromKey || !toKey) return setError("Pick both ends of the transfer.");
    if (fromKey === toKey) return setError("Source and recipient are the same.");
    if (!amountValid) return setError("Amount must be a positive whole number.");
    startTransition(async () => {
      try {
        const res = await createStagedTransfer({ fromKey, toKey, amount });
        if (!res?.ok) return setError(res?.error ?? "Something went wrong.");
        markClean();
        onDone();
      } catch {
        setError(mutationErrorMessage());
      }
    });
  }

  return (
    <Modal modeless title="Stage a transfer" onClose={() => !pending && guardedClose(onCancel)}>
      <div className="mt-3 flex flex-col gap-4">
        <label className="field">
          <span className="field-label">From</span>
          <Select
            value={fromKey}
            onChange={(e) => {
              setFromKey(e.target.value);
              markDirty();
            }}
          >
            {partyOptions()}
          </Select>
        </label>
        <label className="field">
          <span className="field-label">To</span>
          <Select
            value={toKey}
            onChange={(e) => {
              setToKey(e.target.value);
              markDirty();
            }}
          >
            {partyOptions()}
          </Select>
        </label>
        <label className="field" style={{ width: "10rem" }}>
          <span className="field-label">Amount</span>
          <input
            type="number"
            min="1"
            value={amount}
            onChange={(e) => {
              setAmount(e.target.value);
              markDirty();
            }}
            onWheel={(e) => e.currentTarget.blur()}
            placeholder="0"
          />
        </label>

        <FormError>{error}</FormError>

        <div className="modal-actions">
          <button type="button" className="btn-quiet" onClick={() => guardedClose(onCancel)} disabled={pending}>
            Cancel
          </button>
          <button type="button" className="btn" onClick={submit} disabled={pending}>
            {pending ? "Working…" : "Stage it"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
