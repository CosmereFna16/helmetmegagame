"use client";

import { useMemo, useState, useTransition } from "react";
import Modal from "@/app/components/Modal";
import FormError from "@/app/components/FormError";
import useDirtyGuard from "@/app/components/useDirtyGuard";
import { scoreMatch } from "@/lib/fuzzySearch";
import { createStagedMessage, updateStagedMessage } from "./actions";
import { mutationErrorMessage } from "@/app/components/useDeskVersion";
import { GM_MESSAGE_MAX_LENGTH } from "@/lib/constants";

// Stage a private message: text plus a set of recipient characters. Sent as
// DMs at the push — you need to tell different people different things, so a
// Move can carry as many of these as the truth requires. With `existing` it
// edits a staged row instead.

const SEARCH_LIMIT = 12;

export default function MessageComposer({
  moveId = null,
  cavingRollId = null,
  existing = null,
  defaultRecipients = [],
  initialContent = undefined,
  initialRecipients = undefined,
  roster,
  onDone,
  onCancel,
}) {
  const [content, setContent] = useState(existing?.content ?? initialContent ?? "");
  const [recipients, setRecipients] = useState(() =>
    existing
      ? existing.recipients.map((r) => ({ characterId: r.characterId, name: r.name }))
      : (initialRecipients ?? defaultRecipients),
  );
  const [search, setSearch] = useState("");
  const [error, setError] = useState(null);
  const [pending, startTransition] = useTransition();
  const { markDirty, markClean, guardedClose } = useDirtyGuard();

  const matches = useMemo(() => {
    const q = search.trim();
    if (!q) return [];
    const chosen = new Set(recipients.map((r) => r.characterId));
    return roster
      .filter((c) => !chosen.has(c.id))
      .map((c) => ({
        c,
        match: scoreMatch(q, { name: c.name, role: c.roleTitle, faction: c.factionName, zone: c.zoneName, username: c.username }),
      }))
      .filter((r) => r.match)
      .sort((a, b) => b.match.score - a.match.score)
      .slice(0, SEARCH_LIMIT)
      .map((r) => r.c);
  }, [search, roster, recipients]);

  function submit() {
    setError(null);
    startTransition(async () => {
      try {
        const recipientCharacterIds = recipients.map((r) => r.characterId);
        const res = existing
          ? await updateStagedMessage({ stagedMessageId: existing.id, content, recipientCharacterIds })
          : await createStagedMessage({ kind: "PRIVATE", content, recipientCharacterIds, moveId, cavingRollId });
        if (!res?.ok) return setError(res?.error ?? "Something went wrong.");
        markClean();
        onDone();
      } catch {
        setError(mutationErrorMessage());
      }
    });
  }

  const atCap = content.length >= GM_MESSAGE_MAX_LENGTH;

  return (
    <Modal
      title={existing ? "Edit staged message" : "Stage a message"}
      onClose={() => !pending && guardedClose(onCancel)}
    >
      <div className="mt-3 flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <span className="field-label">To</span>
          <div className="flex flex-wrap gap-1.5">
            {recipients.map((r) => (
              <button
                key={r.characterId}
                type="button"
                className="chip"
                onClick={() => {
                  setRecipients((prev) => prev.filter((p) => p.characterId !== r.characterId));
                  markDirty();
                }}
                title="Remove recipient"
              >
                {r.name} ✕
              </button>
            ))}
            {!recipients.length && <span className="text-sm text-muted">nobody yet</span>}
          </div>
          <label className="field">
            <span className="field-label">Add a recipient</span>
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="name, role, faction, zone…" />
          </label>
          {matches.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {matches.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className="chip"
                  onClick={() => {
                    setRecipients((prev) => [...prev, { characterId: c.id, name: c.name }]);
                    setSearch("");
                    markDirty();
                  }}
                >
                  + {c.name}
                  {c.factionName ? <span className="text-muted"> · {c.factionName}</span> : null}
                </button>
              ))}
            </div>
          )}
        </div>

        <label className="field">
          <span className="field-label">
            Message <span className="text-muted">({content.length}/{GM_MESSAGE_MAX_LENGTH})</span>
          </span>
          <textarea
            data-autofocus
            rows={5}
            value={content}
            maxLength={GM_MESSAGE_MAX_LENGTH}
            onChange={(e) => {
              setContent(e.target.value);
              markDirty();
            }}
            placeholder="Lands in their DMs when the turn ends, prefixed »"
          />
          {atCap && (
            <span className="text-xs text-accent">
              At the {GM_MESSAGE_MAX_LENGTH}-character cap — a longer paste gets cut off here.
            </span>
          )}
        </label>

        <FormError>{error}</FormError>

        <div className="modal-actions">
          <button type="button" className="btn-quiet" onClick={() => guardedClose(onCancel)} disabled={pending}>
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
