"use client";

import { useSyncExternalStore } from "react";
import { readSession, writeSession } from "./useSessionState";
import { RefreshGate } from "./useRefresh";

// The client half of the desk's deploy awareness (deployVersion.js is the
// server half). Polling calls checkDeskVersion() first and only refresh()es
// on a same-version "ok", so a deploy or a switchover 5xx becomes a skipped
// tick and a quiet chip instead of Next's build-id-mismatch full navigation.
// `stale` LATCHES: once flagged, auto-refresh stands down until the GM clicks
// the chip, since refreshing a stale desk into the new build IS the reload
// being avoided. Leave NEXT_SERVER_ACTIONS_ENCRYPTION_KEY unset — pinning it
// would make stale action ids survive a deploy and reopen the reload.

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

// The live inbox poll (LiveInboxPoller.js) gets the server's version back in
// every response, so it can latch the same flag without a fetch of its own —
// which is how a deploy shows the chip in ~3s instead of waiting on the 30s
// poll's pre-flight check.
export function noteDeskVersion(seen, baseline) {
  state.lastSeen = seen;
  if (seen !== baseline && !state.stale) {
    state.stale = true;
    for (const callback of listeners) callback();
  }
  return state.stale ? "stale" : "ok";
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

// Wraps a desk in a RefreshGate keyed on the stale latch, so EVERY
// useRefresh() under it — the post-mutation ones included — skips rather
// than refreshing across a deploy boundary (which is a hard reload). A
// component rather than a bare prop because server layouts can't pass a
// function to a client component; this one imports its own guard.
export function DeskStaleRefreshGate({ children }) {
  return <RefreshGate skipWhen={isDeskStale}>{children}</RefreshGate>;
}

// The header chip both desks show once a deploy has latched `stale`: the
// desk has stopped auto-refreshing (see DeskStaleRefreshGate above), and
// this is the GM's own door to the new build. Renders nothing until then.
// Accent goes on an inner span: .btn-quiet is unlayered CSS and outranks
// Tailwind's layered .text-accent on the same element (the .panel trap
// globals.css documents).
export function DeskStaleChip() {
  const stale = useDeskVersion();
  if (!stale) return null;
  return (
    <button
      type="button"
      className="btn-quiet"
      onClick={() => window.location.reload()}
      title="A new version deployed. This desk has stopped auto-refreshing; reload picks the new version up — filters, search, scroll and selection all come back."
    >
      <span className="text-accent">Updated — reload when ready</span>
    </button>
  );
}

// The catch-path error for every desk mutation. A stale build's server
// action rejects with "Failed to find Server Action" (the action ids died
// with the old build); say the true thing when we know the build moved.
export function mutationErrorMessage() {
  return state.stale
    ? "The desk is running an older version than the server — reload the page, then try again."
    : "Something went wrong on the server — your change may not have saved. Try again.";
}
