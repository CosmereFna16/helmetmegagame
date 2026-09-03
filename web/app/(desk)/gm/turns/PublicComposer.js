"use client";

import { useMemo, useState, useTransition } from "react";
import Modal from "@/app/components/Modal";
import FormError from "@/app/components/FormError";
import Select from "@/app/components/Select";
import useDirtyGuard from "@/app/components/useDirtyGuard";
import { createStagedMessage, updateStagedMessage } from "./actions";
import { mutationErrorMessage } from "@/app/components/useDeskVersion";
import { GM_MESSAGE_MAX_LENGTH } from "@/lib/constants";
import { chunkMessage } from "@lifeweb/db/lib/chunkText";

// Stage a public declaration. Posts to the declaration's zone's #summary
// channel at the push. `defaultZoneId` seeds the picker from the Move's own
// zone when staging from a Move desk — leave it null from the tray, where
// there's no Move to infer a zone from, so the GM has to choose rather than
// silently posting to whatever zone happens to sort first.
export default function PublicComposer({
  moveId = null,
  cavingRollId = null,
  existing = null,
  defaultZoneId = null,
  zones,
  onDone,
  onCancel,
}) {
  const [content, setContent] = useState(existing?.content ?? "");
  const [zoneId, setZoneId] = useState(existing?.zoneId ?? defaultZoneId ?? "");
  const [error, setError] = useState(null);
  const [pending, startTransition] = useTransition();
  const { markDirty, markClean, guardedClose } = useDirtyGuard();

  // No maxLength on the textarea: a paste that runs long stays whole and
  // visible so the GM can trim it, rather than being silently cut at the cap.
  const over = content.length > GM_MESSAGE_MAX_LENGTH;
  const chunkCount = useMemo(() => chunkMessage(content.trim()).length, [content]);

  function submit() {
    setError(null);
    if (!zoneId) return setError("Pick a zone.");
    startTransition(async () => {
      try {
        const res = existing
          ? await updateStagedMessage({ stagedMessageId: existing.id, content, zoneId })
          : await createStagedMessage({ kind: "PUBLIC", content, zoneId, moveId, cavingRollId });
        if (!res?.ok) return setError(res?.error ?? "Something went wrong.");
        markClean();
        onDone();
      } catch {
        setError(mutationErrorMessage());
      }
    });
  }

  return (
    <Modal
      modeless
      title={existing ? "Edit public declaration" : "Stage a public declaration"}
      onClose={() => !pending && guardedClose(onCancel)}
    >
      <div className="mt-3 flex flex-col gap-4">
        <label className="field">
          <span className="field-label">
            Declaration{" "}
            <span className={over ? "text-danger" : "text-muted"}>
              ({content.length}/{GM_MESSAGE_MAX_LENGTH})
            </span>
          </span>
          <textarea
            data-autofocus
            rows={5}
            value={content}
            onChange={(e) => {
              setContent(e.target.value);
              markDirty();
            }}
            placeholder="What everyone learns when the turn ends. Posts to the summary channel."
          />
          {over ? (
            <span className="text-xs text-danger">
              Over the {GM_MESSAGE_MAX_LENGTH}-character cap — trim it before staging.
            </span>
          ) : chunkCount > 1 ? (
            <span className="text-xs text-muted">Arrives as {chunkCount} messages, split on blank lines.</span>
          ) : null}
        </label>

        <label className="field" style={{ width: "14rem" }}>
          <span className="field-label">Zone</span>
          <Select
            value={zoneId ?? ""}
            onChange={(e) => {
              setZoneId(e.target.value);
              markDirty();
            }}
            required
          >
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
          <button type="button" className="btn-quiet" onClick={() => guardedClose(onCancel)} disabled={pending}>
            Cancel
          </button>
          <button type="button" className="btn" onClick={submit} disabled={pending || over}>
            {pending ? "Working…" : existing ? "Save" : "Stage it"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
