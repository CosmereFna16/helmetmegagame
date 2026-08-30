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
export default function DevPanelModal({ characterId, name, onClose }) {
  const [refresh] = useRefresh();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    getDevPanelData({ characterId })
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
