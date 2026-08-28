"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import FormError from "@/app/components/FormError";
import { effectSummary, truncate } from "@/app/(desk)/gm/turns/stagedFormat";
import { GM_MESSAGE_MAX_LENGTH } from "@/lib/constants";
import { stageDmAsMessage } from "../actions";

// The "what's actually going on with this player's turn" panel — everything
// a GM used to have to hop to /gm/turns to check: their current Move, any
// messages already staged for the push, any mechanical effects staged
// against them. Collapsible because most conversations aren't mid-adjudication
// and the reply box below is the more common reason to be here.
export default function CanonPanel({ canon, onPrefill }) {
  const [open, setOpen] = useState(true);
  const [staging, setStaging] = useState(false);
  const [stageDraft, setStageDraft] = useState("");
  const [stageError, setStageError] = useState(null);
  const [pending, startTransition] = useTransition();
  const [justStaged, setJustStaged] = useState([]);

  const tagNames = useMemo(() => new Map(Object.entries(canon?.tagNames ?? {})), [canon]);

  if (!canon) return null;

  const { move, pendingMessages, pendingEffects } = canon;
  const allPendingMessages = [...pendingMessages, ...justStaged];

  function submitStage() {
    const content = stageDraft.trim();
    if (!content) return;
    setStageError(null);
    startTransition(async () => {
      const res = await stageDmAsMessage({ characterId: canon.characterId, content });
      if (!res.ok) {
        setStageError(res.error);
        return;
      }
      setJustStaged((prev) => [...prev, res]);
      setStageDraft("");
      setStaging(false);
    });
  }

  return (
    <div className="panel p-4">
      <div className="flex items-center justify-between gap-2">
        <button type="button" className="btn-quiet" onClick={() => setOpen((v) => !v)}>
          {open ? "▾" : "▸"} Canon — {canon.characterName}
        </button>
        {/* Deep-links the row, not just the desk — /gm/turns carries its
            selection in the URL now, so this lands on the Move itself. */}
        <Link href={move ? `/gm/turns/move/${move.id}` : "/gm/turns"} className="btn-quiet">
          Open in Adjudication →
        </Link>
      </div>

      {open && (
        <div className="mt-3 flex flex-col gap-3">
          {move ? (
            <div className="flex flex-col gap-1">
              <p className="field-label">
                This turn&apos;s Move · {move.kindLabel} · {move.reviewLabel}
                {move.rollLabel ? ` · ${move.rollLabel}` : ""}
              </p>
              <p className="text-sm">{move.description}</p>
              {move.resultMessage && (
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm text-muted">Result: {truncate(move.resultMessage, 200)}</p>
                  <button type="button" className="btn-quiet" onClick={() => onPrefill(move.resultMessage)}>
                    Insert result into reply
                  </button>
                </div>
              )}
            </div>
          ) : (
            <p className="text-sm text-muted">No Move filed this turn.</p>
          )}

          {allPendingMessages.length > 0 && (
            <div className="flex flex-col gap-1">
              <p className="field-label">Staged for turn end</p>
              {allPendingMessages.map((m) => (
                <div key={m.id} className="flex items-start justify-between gap-2">
                  <p className="text-sm text-muted">{truncate(m.content, 140)}</p>
                  <button type="button" className="btn-quiet" onClick={() => onPrefill(m.content)}>
                    Insert text
                  </button>
                </div>
              ))}
            </div>
          )}

          {pendingEffects.length > 0 && (
            <div className="flex flex-col gap-1">
              <p className="field-label">Staged effects</p>
              {pendingEffects.map((e) => (
                <p key={e.id} className="text-sm text-muted mono">
                  {effectSummary(e.payload, tagNames)}
                </p>
              ))}
            </div>
          )}

          {staging ? (
            <div className="flex flex-col gap-2">
              <label className="field">
                <span className="field-label">Stage a message for the turn-end push</span>
                <textarea rows={2} value={stageDraft} onChange={(e) => setStageDraft(e.target.value)} />
              </label>
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-muted">
                  {stageDraft.length} / {GM_MESSAGE_MAX_LENGTH}
                </span>
                <div className="flex gap-2">
                  <button type="button" className="btn-quiet" disabled={pending} onClick={() => setStaging(false)}>
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="btn"
                    disabled={pending || !stageDraft.trim() || stageDraft.length > GM_MESSAGE_MAX_LENGTH}
                    onClick={submitStage}
                  >
                    {pending ? "Staging…" : "Stage"}
                  </button>
                </div>
              </div>
              <FormError>{stageError}</FormError>
            </div>
          ) : (
            <button type="button" className="btn-quiet self-start" onClick={() => setStaging(true)}>
              Stage for turn end
            </button>
          )}
        </div>
      )}
    </div>
  );
}
