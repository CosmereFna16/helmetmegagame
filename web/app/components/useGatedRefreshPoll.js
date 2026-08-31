"use client";

import { useEffect, useState } from "react";
import { useRefresh } from "./useRefresh";
import { isAnyDirty } from "./useDirtyGuard";
import { checkDeskVersion, isDeskStale } from "./useDeskVersion";

// The desks' shared live-refresh poll — one definition of the gates, so
// /gm/turns and /gm/players can't drift apart on them:
//
//   - the tab is visible (a hidden desk doesn't need to be current)
//   - no modal is open (an in-flight composer shouldn't be yanked around)
//   - nothing is dirty (isAnyDirty — a half-typed Result box pauses the poll)
//   - the build isn't stale, and the server answers /api/desk-version with
//     the same build this page rendered from (useDeskVersion.js) — because a
//     router.refresh() across builds trips Next's mismatch fallback, a full
//     browser navigation that eats the GM's view state.
//
// Conditions are read at fire time, not tracked as deps, so the interval
// never needs tearing down and rebuilding. Returns the timestamp of the last
// refresh that actually ran, for an "updated HH:MM" stamp.
export default function useGatedRefreshPoll(intervalMs, deployVersion) {
  const [refresh] = useRefresh();
  const [lastRefreshedAt, setLastRefreshedAt] = useState(null);

  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      if (document.querySelector(".modal-overlay")) return;
      if (isAnyDirty()) return;
      if (isDeskStale()) return;
      (async () => {
        if ((await checkDeskVersion(deployVersion)) !== "ok") return;
        refresh();
        setLastRefreshedAt(new Date());
      })();
    }, intervalMs);
    return () => clearInterval(id);
  }, [refresh, intervalMs, deployVersion]);

  return lastRefreshedAt;
}
