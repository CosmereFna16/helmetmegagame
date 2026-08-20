"use client";

import { useCallback, useEffect, useState } from "react";
import { useConfirm } from "./ConfirmProvider";

// Guards a panel that holds unsaved edits. Exiting by ANY route other than an
// explicit save has to be confirmed, and confirming discards the edits — the
// rule the adjudication panels are held to.
//
// Two layers: guardedClose() covers in-app exits (overlay click, Cancel,
// Escape), and a beforeunload listener covers the browser-level ones (reload,
// tab close, back). The browser dialog's wording is fixed by the user agent;
// only whether it appears is ours to control.
export default function useDirtyGuard({ enabled = true } = {}) {
  const confirm = useConfirm();
  const [dirty, setDirty] = useState(false);

  const markDirty = useCallback(() => setDirty(true), []);
  const markClean = useCallback(() => setDirty(false), []);

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
      setDirty(false);
      onClose?.();
      return true;
    },
    [confirm, dirty],
  );

  return { dirty, markDirty, markClean, guardedClose };
}
