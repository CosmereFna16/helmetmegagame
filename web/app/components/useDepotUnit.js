"use client";

import { useCallback, useSyncExternalStore } from "react";

// Which currency the Depot's price columns are printed in, persisted per
// browser. Same useSyncExternalStore-over-localStorage shape as
// useChimeMuted.js: reading localStorage belongs in the snapshot function,
// never an effect.
//
// "res" (⬢, the catalog's own denomination) or "obol" (¢, what the counter
// settles in). Display only — no server action reads it.

const KEY = "depot-unit";

function subscribe(callback) {
  window.addEventListener("storage", callback);
  return () => window.removeEventListener("storage", callback);
}

function read() {
  try {
    return window.localStorage.getItem(KEY) === "obol" ? "obol" : "res";
  } catch {
    // private window / blocked site data
    return "res";
  }
}

function readServer() {
  return "res";
}

function write(unit) {
  try {
    window.localStorage.setItem(KEY, unit === "obol" ? "obol" : "res");
    // The storage event doesn't fire in the tab that wrote it — nudge the
    // subscriber manually so this tab's own toggle reflects immediately.
    window.dispatchEvent(new Event("storage"));
  } catch {
    /* private window / blocked site data */
  }
}

export default function useDepotUnit() {
  const unit = useSyncExternalStore(subscribe, read, readServer);
  const setUnit = useCallback((next) => write(next), []);
  return [unit, setUnit];
}
