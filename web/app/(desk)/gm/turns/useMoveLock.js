"use client";

import { useEffect, useRef, useState } from "react";
import { claimMoveLock, refreshMoveLock, releaseMoveLock } from "./actions";

// The cooperative move lock's client half, extracted from the old MovePanel:
// claim on mount, 30s heartbeat, release on unmount, and a sendBeacon for the
// tab that dies — the TTL is the real guarantee, the beacon just shortens the
// next GM's wait. See gm/turns/actions.js#claimMoveLock for the server rule.
const HEARTBEAT_MS = 30_000;

export default function useMoveLock(actionId, { enabled = true } = {}) {
  const [locked, setLocked] = useState(false);
  const [error, setError] = useState(null);
  const lockedRef = useRef(false);

  useEffect(() => {
    if (!actionId || !enabled) return undefined;
    let cancelled = false;

    (async () => {
      const res = await claimMoveLock({ actionId });
      if (cancelled) return;
      if (!res?.ok) return setError(res?.error ?? "Could not claim this Move.");
      lockedRef.current = true;
      setLocked(true);
    })();

    const beat = setInterval(async () => {
      if (!lockedRef.current) return;
      const res = await refreshMoveLock({ actionId });
      if (!res?.ok) {
        lockedRef.current = false;
        setLocked(false);
        setError(res?.error ?? "Your hold on this Move expired.");
      }
    }, HEARTBEAT_MS);

    const onUnload = () => {
      if (lockedRef.current) navigator.sendBeacon?.(`/api/move-lock/release?actionId=${actionId}`);
    };
    window.addEventListener("pagehide", onUnload);

    return () => {
      cancelled = true;
      clearInterval(beat);
      window.removeEventListener("pagehide", onUnload);
      if (lockedRef.current) releaseMoveLock({ actionId });
      lockedRef.current = false;
      // No setState in cleanup: the desk is keyed by move id, so switching
      // moves remounts the hook with fresh state instead.
    };
  }, [actionId, enabled]);

  // For callers that finish a mutation themselves (Solve releases the lock
  // server-side) and must stop the heartbeat from reclaiming it.
  const dropLocal = () => {
    lockedRef.current = false;
    setLocked(false);
  };

  return { locked, error, dropLocal };
}
