"use client";

import { useEffect } from "react";
import { readSession, writeSession } from "./useSessionState";
import { readVersionCrumb } from "./useDeskVersion";

// TEMPORARY DIAGNOSTIC — the desks keep hard-reloading for every GM, and
// production evidence (Railway HTTP logs, 2026-08-30) shows a *successful*,
// same-build RSC refresh being followed ~300ms later by a full browser
// navigation. The remaining suspects are all inside Next's client-side
// flight processing, and they differ in exactly one observable: the loud
// branch console.error()s "Failed to fetch RSC payload … Falling back to
// browser navigation." right before navigating, the silent branches don't.
//
// So: tap console.error into a small sessionStorage ring buffer, and on the
// NEXT page load beacon the previous page's death report — navigation type,
// the console tail, and the version-check crumb — to /api/desk-telemetry,
// which just console.logs it into Railway's logs. A reload with a captured
// fallback message = the decode/apply branch (with the underlying error!);
// a reload with an empty tail = one of the silent branches. Remove this
// whole file once the reloads are classified and fixed.

const TAIL_KEY = "gm-desk-console-tail";

let tapInstalled = false;
let landedSent = false;

function formatArg(a) {
  try {
    if (typeof a === "string") return a;
    if (a instanceof Error) return `${a.name}: ${a.message}`;
    return JSON.stringify(a);
  } catch {
    return String(a);
  }
}

function installTap() {
  if (tapInstalled) return;
  tapInstalled = true;
  const original = console.error.bind(console);
  console.error = (...args) => {
    try {
      const text = args.map(formatArg).join(" ").slice(0, 400);
      if (text) {
        const tail = readSession(TAIL_KEY, null) ?? [];
        writeSession(TAIL_KEY, [...tail.slice(-4), { at: Date.now(), text }]);
      }
    } catch {
      /* never let the tap break the console */
    }
    original(...args);
  };
}

function beacon(payload) {
  try {
    navigator.sendBeacon(
      "/api/desk-telemetry",
      new Blob([JSON.stringify(payload)], { type: "application/json" }),
    );
  } catch {
    /* diagnostics must never throw */
  }
}

export default function useReloadTelemetry(surface, deployVersion) {
  useEffect(() => {
    installTap();

    // One "landed" report per DOCUMENT (not per mount — a soft navigation
    // back onto the desk re-mounts this hook but describes the same load):
    // how this document arrived, what the previous page's console said
    // before it died, and what the version poll last saw. sessionStorage
    // carries both across the reload.
    if (!landedSent) {
      landedSent = true;
      const nav = performance.getEntriesByType("navigation")[0]?.type ?? "unknown";
      const tail = readSession(TAIL_KEY, null) ?? [];
      writeSession(TAIL_KEY, []); // consumed
      beacon({ kind: "landed", surface, nav, deployVersion, crumb: readVersionCrumb(), tail });
    }

    // Best-effort exit report too — catches the case where the next page
    // isn't ours (or never loads) and includes anything console.error'd in
    // this document's final moments.
    const onPageHide = () => {
      const tail = readSession(TAIL_KEY, null) ?? [];
      if (tail.length) beacon({ kind: "leaving", surface, deployVersion, tail });
    };
    window.addEventListener("pagehide", onPageHide);
    return () => window.removeEventListener("pagehide", onPageHide);
  }, [surface, deployVersion]);
}
