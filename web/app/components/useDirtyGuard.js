"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useConfirm } from "./ConfirmProvider";

// Guards a panel that holds unsaved edits. Exiting by ANY route other than an
// explicit save has to be confirmed, and confirming discards the edits — the
// rule the adjudication panels are held to.
//
// Two layers: guardedClose() covers in-app exits (overlay click, Cancel,
// Escape), and a beforeunload listener covers the browser-level ones (reload,
// tab close, back). The browser dialog's wording is fixed by the user agent;
// only whether it appears is ours to control.
// Module-level counter, incremented/decremented alongside each instance's own
// dirty flag. It's the only cross-component way to ask "is ANYTHING dirty
// right now" (the live-refresh poll on /gm/turns needs exactly that, without
// prop-drilling every panel's guard up to Workspace). Backward compatible:
// nothing else has to change to keep working.
let dirtyInstances = 0;
export function isAnyDirty() {
  return dirtyInstances > 0;
}

export default function useDirtyGuard({ enabled = true } = {}) {
  const confirm = useConfirm();
  const [dirty, setDirty] = useState(false);
  const dirtyRef = useRef(false);

  const markDirty = useCallback(() => {
    setDirty((prev) => {
      if (!prev) dirtyInstances += 1;
      dirtyRef.current = true;
      return true;
    });
  }, []);
  const markClean = useCallback(() => {
    setDirty((prev) => {
      if (prev) dirtyInstances = Math.max(0, dirtyInstances - 1);
      dirtyRef.current = false;
      return false;
    });
  }, []);

  // Unmounting with unsaved edits still in flight (e.g. a hard navigation
  // past beforeunload) must not leave the counter stuck positive.
  useEffect(() => {
    return () => {
      if (dirtyRef.current) dirtyInstances = Math.max(0, dirtyInstances - 1);
    };
  }, []);

  useEffect(() => {
    if (!enabled || !dirty) return undefined;
    const onBeforeUnload = (e) => {
      e.preventDefault();
      // Legacy browsers require returnValue to be set for the prompt to show.
      e.returnValue = "";
      return "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [enabled, dirty]);

  const guardedClose = useCallback(
    async (onClose) => {
      if (dirty) {
        const ok = await confirm({
          title: "Discard your changes?",
          message: "This panel has unsaved edits. Closing reverts every change you've made.",
          confirmLabel: "Discard",
          cancelLabel: "Keep editing",
        });
        if (!ok) return false;
      }
      markClean();
      onClose?.();
      return true;
    },
    [confirm, dirty, markClean],
  );

  return { dirty, markDirty, markClean, guardedClose };
}
