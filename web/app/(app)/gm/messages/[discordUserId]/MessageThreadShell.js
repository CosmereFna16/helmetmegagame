"use client";

import { useRef } from "react";
import ThreadPane from "./ThreadPane";
import CanonPanel from "./CanonPanel";

// Wires CanonPanel's prefill buttons into ThreadPane's composer draft.
// ThreadPane already exposes `registerPrefill` (a setter it calls with the
// "write this into the draft" function) as an extension point — this is the
// one caller that uses it, holding the registered function in a ref so
// CanonPanel's buttons (a sibling, not a child of ThreadPane) can reach it.
// The ref is only ever written from an effect/callback, never read during
// render, so it stays clear of the refs-during-render lint rule.
export default function MessageThreadShell({ canon, ...threadProps }) {
  const prefillRef = useRef(null);

  return (
    <div className="flex flex-col gap-4">
      <CanonPanel canon={canon} onPrefill={(text) => prefillRef.current?.(text)} />
      <ThreadPane {...threadProps} registerPrefill={(fn) => (prefillRef.current = fn)} />
    </div>
  );
}
