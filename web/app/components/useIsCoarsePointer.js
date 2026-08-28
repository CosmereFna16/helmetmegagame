"use client";

import { useSyncExternalStore } from "react";

const QUERY = "(pointer: coarse)";

function subscribe(callback) {
  const mql = window.matchMedia(QUERY);
  mql.addEventListener("change", callback);
  return () => mql.removeEventListener("change", callback);
}

function getSnapshot() {
  return window.matchMedia(QUERY).matches;
}

function getServerSnapshot() {
  return false;
}

// True on a touch-primary device (no reliable hover/precise pointer) — used
// to skip desktop-only affordances like keyboard shortcuts and hover hints.
export function useIsCoarsePointer() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
