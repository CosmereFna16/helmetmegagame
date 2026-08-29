"use client";

import { useState, useTransition } from "react";
import Modal from "@/app/components/Modal";
import FormError from "@/app/components/FormError";
import Select from "@/app/components/Select";
import { createStagedMessage, updateStagedMessage } from "./actions";
import { GM_MESSAGE_MAX_LENGTH } from "@/lib/constants";

// Stage a public declaration. Posts to the declaration's zone's #summary
// channel at the push.
export default function PublicComposer({ moveId = null, cavingRollId = null, existing = null, zones, onDone, onCancel }) {
  const [content, setContent] = useState(existing?.content ?? "");
  const [zoneId, setZoneId] = useState(existing?.zoneId ?? zones[0]?.id ?? "");
  const [error, setError] = useState(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    setError(null);
    if (!zoneId) return setError("Pick a zone.");
    startTransition(async () => {
      const res = existing
        ? await updateStagedMessage({ stagedMessageId: existing.id, content, zoneId })
        : await createStagedMessage({ kind: "PUBLIC", content, zoneId, moveId, cavingRollId });
      if (!res?.ok) return setError(res?.error ?? "Something went wrong.");
      onDone();
    });
  }

  return (
    <Modal title={existing ? "Edit public declaration" : "Stage a public declaration"} onClose={() => !pending && onCancel()}>
      <div className="mt-3 flex flex-col gap-4">
        <label className="field">
          <span className="field-label">
            Declaration <span className="text-muted">({content.length}/{GM_MESSAGE_MAX_LENGTH})</span>
          </span>
          <textarea
            rows={5}
            value={content}
            maxLength={GM_MESSAGE_MAX_LENGTH}
            onChange={(e) => setContent(e.target.value)}
            placeholder="What everyone learns when the turn ends. Posts to the summary channel."
          />
        </label>

        <label className="field" style={{ width: "14rem" }}>
          <span className="field-label">Zone</span>
          <Select value={zoneId ?? ""} onChange={(e) => setZoneId(e.target.value)} required>
            {!zoneId && <option value="">Pick a zone…</option>}
            {zones.map((z) => (
              <option key={z.id} value={z.id}>
                {z.name}
              </option>
            ))}
          </Select>
        </label>

        <FormError>{error}</FormError>

        <div className="modal-actions">
          <button type="button" className="btn-quiet" onClick={onCancel} disabled={pending}>
            Cancel
          </button>
          <button type="button" className="btn" onClick={submit} disabled={pending}>
            {pending ? "Working…" : existing ? "Save" : "Stage it"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
