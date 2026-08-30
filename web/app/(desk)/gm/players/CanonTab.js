"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, useTransition } from "react";
import FormError from "@/app/components/FormError";
import { effectSummary, truncate } from "@/app/(desk)/gm/turns/stagedFormat";
import { GM_MESSAGE_MAX_LENGTH } from "@/lib/constants";
import { getPlayerCanon, stageDmAsMessage } from "./actions";
import { writeDmDraft } from "./dmDraft";

// "What's actually going on with this player's turn" — their current Move,
// any messages already staged for the push, any effects staged against them,
// plus a box to stage one more.
//
// This was the player desk's Canon dossier tab, which arrived with the
// person route's page load. It is an extra tab on the shared inspector now
// (see InspectorHost), and the inspector can be pointed at anybody — so it
// fetches per character on demand, the same discipline as the base tabs.
export default function CanonTab({ characterId, discordUserId, onPastMoves }) {
  const [state, setState] = useState({ loading: true, canon: null, error: null });
  const [staging, setStaging] = useState(false);
  const [stageDraft, setStageDraft] = useState("");
  const [stageError, setStageError] = useState(null);
  const [pending, startTransition] = useTransition();
  const [justStaged, setJustStaged] = useState([]);

  // setState lands after the await, never synchronously in the effect body
  // (react-hooks/set-state-in-effect is an error in this repo).
  useEffect(() => {
    if (!characterId) return undefined;
    let cancelled = false;
    (async () => {
      const res = await getPlayerCanon({ characterId });
      if (cancelled) return;
      if (res?.ok) setState({ loading: false, canon: res.canon, error: null });
      else setState({ loading: false, canon: null, error: res?.error ?? "Couldn't load that." });
    })();
    return () => {
      cancelled = true;
    };
  }, [characterId]);

  const canon = state.canon;
  const tagNames = useMemo(() => new Map(Object.entries(canon?.tagNames ?? {})), [canon]);

  function insert(text) {
    writeDmDraft(discordUserId, text);
  }

  function submitStage() {
    const content = stageDraft.trim();
    if (!content) return;
    setStageError(null);
    startTransition(async () => {
      const res = await stageDmAsMessage({ characterId, content });
      if (!res.ok) {
        setStageError(res.error);
        return;
      }
      setJustStaged((prev) => [...prev, res]);
      setStageDraft("");
      setStaging(false);
    });
  }

  if (state.loading) return <p className="p-3 text-sm text-muted">Loading…</p>;
  if (state.error) return <p className="p-3 text-sm form-error">{state.error}</p>;
  if (!canon) return null;

  const { move, pendingMessages, pendingEffects } = canon;
  const allPendingMessages = [...pendingMessages, ...justStaged];

  return (
    <div className="flex flex-col gap-3 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="field-label">This turn</span>
        <div className="flex flex-wrap gap-2">
          {/* Canon owns this turn; everything before it is the inspector's
              Moves tab, so point at that rather than repeating it here. */}
          {onPastMoves && (
            <button type="button" className="btn-quiet" onClick={onPastMoves}>
              Past moves →
            </button>
          )}
          {/* Deep-links the row, not just the desk — /gm/turns carries its
              selection in the URL, so this lands on the Move itself. */}
          <Link href={move ? `/gm/turns/move/${move.id}` : "/gm/turns"} className="btn-quiet">
            Open in Adjudication →
          </Link>
        </div>
      </div>

      {move ? (
        <div className="flex flex-col gap-1">
          <p className="field-label">
            Move · {move.kindLabel} · {move.reviewLabel}
            {move.rollLabel ? ` · ${move.rollLabel}` : ""}
          </p>
          <p className="text-sm">{move.description}</p>
          {move.resultMessage && (
            <div className="flex items-start justify-between gap-2">
              <p className="text-sm text-muted">Result: {truncate(move.resultMessage, 200)}</p>
              {discordUserId && (
                <button type="button" className="btn-quiet" onClick={() => insert(move.resultMessage)}>
                  Insert result into reply
                </button>
              )}
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
              {discordUserId && (
                <button type="button" className="btn-quiet" onClick={() => insert(m.content)}>
                  Insert text
                </button>
              )}
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
  );
}
