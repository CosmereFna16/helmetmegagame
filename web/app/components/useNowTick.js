"use client";

import { useEffect, useState } from "react";

// A clock that re-renders on a beat, for relative times ("3m", "Today at…")
// that would otherwise freeze at whatever they said when the row mounted.
// setState from a timer callback, not from the effect body — which is the
// distinction react-hooks/set-state-in-effect draws.
export default function useNowTick(intervalMs = 30_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}
