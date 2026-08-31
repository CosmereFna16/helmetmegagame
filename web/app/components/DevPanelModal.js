"use client";

import { useEffect, useState } from "react";
import { useRefresh } from "@/app/components/useRefresh";
import Modal from "@/app/components/Modal";
import DevPanel from "@/app/(app)/gm/dev/characters/[characterId]/DevPanel";
import { getDevPanelData } from "./devPanelActions";

// The full Dev Character Panel, mounted as a modal over a desk (the
// adjudication desk's Workspace.js, the player desk's RosterTable.js and
// ConversationPane.js) instead of the standalone /gm/dev/characters/[id]
// page, so a GM never leaves the desk or loses its state. Shared here rather
// than living under one desk, since more than one desk mounts it.
//
// The data assembly is identical to the page's — web/lib/devPanelData.js —
// fetched here through this component's own server action
// (devPanelActions.js) rather than the page's RSC. DevPanel itself owns the
// Modal shell when `frame="modal"`, because the dirty (staged-edit) state
// lives inside it and closing has to route through the same guard
// Apply/Cancel use.
// Opening the panel is a click on a small icon button, and the DTO takes long
// enough that the modal visibly sits on "Loading the panel…". So the fetch is
// allowed to start BEFORE the modal mounts: DevCharacterButton calls
// prefetchDevPanel on pointerdown, and the mount below picks up the promise
// already in flight instead of firing its own.
//
// Module-level on purpose — it has to outlive the modal, which doesn't exist
// yet when the prefetch starts. Entries are keyed by character and expire, so
// a stale panel is never shown for a sheet someone edited in between.
const PREFETCH_TTL_MS = 20_000;
const prefetched = new Map();

export function prefetchDevPanel(characterId) {
  if (!characterId) return;
  // Sweep expired entries — a pointerdown that never became a click would
  // otherwise hold its full DTO for the life of the page.
  for (const [id, entry] of prefetched) {
    if (Date.now() - entry.at >= PREFETCH_TTL_MS) prefetched.delete(id);
  }
  const hit = prefetched.get(characterId);
  if (hit && Date.now() - hit.at < PREFETCH_TTL_MS) return;
  // A rejection is swallowed here and re-observed by whoever awaits the
  // promise — without this, a prefetch nobody consumed is an unhandled
  // rejection in the console.
  const promise = getDevPanelData({ characterId }).catch((err) => ({ ok: false, error: err?.message }));
  prefetched.set(characterId, { at: Date.now(), promise });
}

// The pending/fresh prefetch for this character, consumed once.
function takePrefetch(characterId) {
  const hit = prefetched.get(characterId);
  if (!hit) return null;
  prefetched.delete(characterId);
  if (Date.now() - hit.at >= PREFETCH_TTL_MS) return null;
  return hit.promise;
}

export default function DevPanelModal({ characterId, name, onClose }) {
  const [refresh] = useRefresh();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (takePrefetch(characterId) ?? getDevPanelData({ characterId }))
      .then((res) => {
        if (cancelled) return;
        if (!res?.ok) {
          setError(res?.error ?? "Something went wrong.");
          return;
        }
        setData(res.props);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err?.message ?? "Something went wrong.");
      });
    return () => {
      cancelled = true;
    };
  }, [characterId]);

  async function reload() {
    // Always a fresh read: a microaction just changed the sheet, so any
    // prefetch sitting in the map is by definition out of date.
    prefetched.delete(characterId);
    const res = await getDevPanelData({ characterId });
    if (res?.ok) setData(res.props);
    // The desk's own RSC data (queue rows, staged hints) can be stale too —
    // a microaction here (kill, revive, resync…) can change what the desk
    // shows for this character elsewhere on the page. Through useRefresh, so
    // the desk under this modal doesn't blink through its loading skeleton.
    refresh();
  }

  if (!data) {
    return (
      <Modal title={name} onClose={onClose}>
        {error ? (
          <p className="form-error" role="alert">{error}</p>
        ) : (
          <p className="text-sm text-muted">Loading the panel…</p>
        )}
      </Modal>
    );
  }

  return (
    <DevPanel
      {...data}
      frame="modal"
      onClose={onClose}
      onMutated={reload}
      onDeleted={() => {
        onClose();
        refresh();
      }}
    />
  );
}
