"use client";

import { useSyncExternalStore } from "react";
import { readSession, writeSession } from "./useSessionState";

// The client half of the desk's deploy awareness (deployVersion.js is the
// server half). The adjudication desk used to reload out from under a GM
// every time a push landed: its 45s poll (or the refresh() after a Solve)
// fetched an RSC payload from the NEW build, Next's build-id check failed,
// and the router fell back to a full browser navigation. Now the poll calls
// checkDeskVersion() first and only refresh()es on a same-version "ok" —
// a deploy or a switchover 5xx becomes a skipped tick and a quiet chip, not
// a page reload.
//
// Module store + useSyncExternalStore, the same shape useSessionState.js and
// useDirtyGuard.js already use: the interval needs a synchronous reader
// (isDeskStale), the chip needs a subscription (useDeskVersion), and the
// composers' catch blocks need neither (mutationErrorMessage).
//
// `stale` LATCHES. Refreshing a stale desk into the new build IS the reload
// we're avoiding, so once flagged, auto-refresh stands down until the GM
// clicks the chip. The header's "updated HH:MM" stamp going cold is the
// secondary cue.

const CRUMB_KEY = "gm-desk-version-crumb";

const state = { stale: false, lastSeen: null };
const listeners = new Set();

function subscribe(callback) {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

export function isDeskStale() {
  return state.stale;
}

// baseline = the version the page was RENDERED by (a page.js prop), which is
// exactly what the client's own RSC payloads are tied to.
export async function checkDeskVersion(baseline) {
  let outcome = "unreachable";
  try {
    const res = await fetch("/api/desk-version", {
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });
    if (res.ok) {
      const { version } = await res.json();
      state.lastSeen = version;
      outcome = version === baseline ? "ok" : "stale";
    }
  } catch {
    /* offline, timing out, or mid-switchover — all mean "don't refresh now",
       never "reload the page" */
  }
  if (outcome === "stale" && !state.stale) {
    state.stale = true;
    for (const callback of listeners) callback();
  }
  // Breadcrumb for the mount-time diagnostic line (Workspace.js): after a
  // reload it says whether the last poll before it saw a new build, a dead
  // server, or nothing unusual (= the GM's own ⌘R).
  writeSession(CRUMB_KEY, { at: Date.now(), outcome, baseline, seen: state.lastSeen });
  return outcome;
}

export function readVersionCrumb() {
  return readSession(CRUMB_KEY, null);
}

export default function useDeskVersion() {
  return useSyncExternalStore(subscribe, isDeskStale, getServerSnapshot);
}

function getServerSnapshot() {
  return false;
}

// The catch-path error for every desk mutation. A stale build's server
// action rejects with "Failed to find Server Action" (the action ids died
// with the old build), which used to render as a shrug. When we know the
// build moved, say the true thing instead.
export function mutationErrorMessage() {
  return state.stale
    ? "The desk is running an older version than the server — reload the page, then try again."
    : "Something went wrong on the server — your change may not have saved. Try again.";
}
