"use client";

import { useCallback, useSyncExternalStore } from "react";

// Whether the GM inbox chime (chime.js) is muted, persisted per-browser. Same
// useSyncExternalStore-over-localStorage shape as usePins.js: reading
// localStorage belongs in the snapshot function, never an effect.

const KEY = "gm-chime-muted";

function subscribe(callback) {
  window.addEventListener("storage", callback);
  return () => window.removeEventListener("storage", callback);
}

function read() {
  try {
    return window.localStorage.getItem(KEY) === "1";
  } catch {
    // private window / blocked site data
    return false;
  }
}

function readServer() {
  return false;
}

function write(muted) {
  try {
    window.localStorage.setItem(KEY, muted ? "1" : "0");
    // The storage event doesn't fire in the tab that wrote it — nudge the
    // subscriber manually so this tab's own toggle reflects immediately.
    window.dispatchEvent(new Event("storage"));
  } catch {
    /* private window / blocked site data */
  }
}

export default function useChimeMuted() {
  const muted = useSyncExternalStore(subscribe, read, readServer);
  const setMuted = useCallback((next) => write(next), []);
  return [muted, setMuted];
}
