"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { isAnyDirty } from "@/app/components/useDirtyGuard";

const REFRESH_MS = 30_000;

// Live inbox refresh — same shape as the adjudication desk's queue poll
// (Workspace.js), skipped while the tab is hidden, a modal is open, or any
// panel on the page has unsaved edits (the composer draft included, once it
// wires a dirty guard). Conditions are read at fire time, not tracked as
// deps, so the interval never needs tearing down and rebuilding.
export default function InboxPoller() {
  const router = useRouter();

  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      if (document.querySelector(".modal-overlay")) return;
      if (isAnyDirty()) return;
      router.refresh();
    }, REFRESH_MS);
    return () => clearInterval(id);
  }, [router]);

  return null;
}
