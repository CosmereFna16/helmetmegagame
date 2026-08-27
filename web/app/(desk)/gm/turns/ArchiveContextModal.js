"use client";

import { useEffect, useRef, useState } from "react";
import Modal from "@/app/components/Modal";
import FormError from "@/app/components/FormError";
import MarkdownContent from "@/app/components/MarkdownContent";
import { getArchiveContext } from "./actions";

// "In context": the ~30 messages before/after one archived line, in the same
// Discord channel/thread, so a GM clicking an old transcript row gets the
// scene instead of just the one line. Its own fetch, its own modal — it's
// opened from the Archive tab's rows, not part of the inspector cache.
export default function ArchiveContextModal({ archiveEntryId, onClose }) {
  const [state, setState] = useState({ loading: true, data: null, error: null });
  const anchorRef = useRef(null);

  useEffect(() => {
    if (!archiveEntryId) return undefined;
    let cancelled = false;
    (async () => {
      const res = await getArchiveContext({ archiveEntryId });
      if (cancelled) return;
      if (res?.ok) setState({ loading: false, data: res, error: null });
      else setState({ loading: false, data: null, error: res?.error ?? "Couldn't load that." });
    })();
    return () => {
      cancelled = true;
    };
  }, [archiveEntryId]);

  useEffect(() => {
    if (state.data) anchorRef.current?.scrollIntoView({ block: "center" });
  }, [state.data]);

  return (
    <Modal
      title="In context"
      width="wide"
      onClose={onClose}
      actions={
        state.data?.jumpUrl ? (
          <a className="btn-quiet" href={state.data.jumpUrl} target="_blank" rel="noreferrer">
            Open in Discord ↗
          </a>
        ) : null
      }
    >
      {state.loading && <p className="p-3 text-sm text-muted">Loading the scene…</p>}
      {state.error && (
        <div className="p-3">
          <FormError>{state.error}</FormError>
        </div>
      )}
      {state.data && (
        <div className="p-3">
          <p className="mb-2 text-xs text-muted">{state.data.channelLabel}</p>
          <div className="flex flex-col gap-3" style={{ maxHeight: "65vh", overflowY: "auto" }}>
            {state.data.entries.map((e) => (
              <div
                key={e.id}
                ref={e.id === state.data.anchorId ? anchorRef : undefined}
                data-anchor={e.id === state.data.anchorId || undefined}
                className={e.id === state.data.anchorId ? "desk-archive-anchor" : undefined}
              >
                <p className="text-xs text-muted">
                  {e.concealedAlias ? `${e.concealedAlias} (${e.characterName})` : e.characterName}
                  {e.turnNumber != null ? ` · turn ${e.turnNumber}` : ""}
                  {` · ${e.sentAt.slice(0, 16).replace("T", " ")}`}
                </p>
                <div className="text-sm">
                  <MarkdownContent content={e.content} />
                </div>
              </div>
            ))}
          </div>
          <p className="mt-3 text-xs text-muted">
            Old messages may already be wiped from Discord; the transcript is the record.
          </p>
        </div>
      )}
    </Modal>
  );
}
