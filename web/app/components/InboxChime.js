"use client";

import { useEffect, useRef } from "react";
import { playChime, chimedRecently } from "./chime";
import useChimeMuted from "./useChimeMuted";

// Watches the unread-conversation count and chimes when it rises. Mounted
// once in NavRailAsync so it fires on any GM page, riding the same
// router.refresh() polls the desks already run (Workspace.js every 45s,
// InboxPoller.js every 30s) rather than opening its own timer.
//
// The last-seen count lives in a ref, not state: a fresh page load must be
// silent even with unread messages already sitting there, and a ref lets
// that seed happen without ever calling setState during render/effect.
export default function InboxChime({ count }) {
  const lastCount = useRef(null);
  const [muted] = useChimeMuted();

  useEffect(() => {
    if (lastCount.current === null) {
      lastCount.current = count;
      return;
    }
    // On the player desk the live poll (LiveInboxPoller.js) has usually rung
    // already for the same arrival; the count catching up 30s later is not a
    // second message.
    if (count > lastCount.current && !muted && !chimedRecently()) playChime();
    lastCount.current = count;
  }, [count, muted]);

  return null;
}
