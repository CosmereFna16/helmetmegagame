"use client";

import { useEffect } from "react";
import { readSession, writeSession } from "./useSessionState";
import { readVersionCrumb } from "./useDeskVersion";

// TEMPORARY DIAGNOSTIC, v2 — the desks keep hard-reloading for every GM.
// Round-2 forensics (Railway edge logs, 2026-08-31) showed the healthy cycle
// everywhere (action POST → flight GET → applied), but on each captured
// reload the expected flight fetch NEVER REACHED THE EDGE: the failure is
// inside the browser, and it is silent (no console.error — v1's tail came
// back empty).
//
// So v2 records what only the browser can see, into a sessionStorage ring
// buffer that survives the reload and is beaconed to /api/desk-telemetry on
// the next document load:
//   - every same-origin fetch's fate: path, RSC-ish markers, status or the
//     exact exception it died with, duration
//   - window "error" and "unhandledrejection" events
//   - console.error text (kept from v1)
//   - at beacon time, the browser's own resource-timing tail as a
//     cross-check (a failed fetch shows up with transferSize 0)
//
// Remove this file (and /api/desk-telemetry) once the reloads are classified
// and fixed.

const TAIL_KEY = "gm-desk-console-tail";
const MAX_EVENTS = 14;

let tapsInstalled = false;
let landedSent = false;

function pushEvent(entry) {
  try {
    const tail = readSession(TAIL_KEY, null) ?? [];
    writeSession(TAIL_KEY, [...tail.slice(-(MAX_EVENTS - 1)), entry]);
  } catch {
    /* diagnostics must never throw */
  }
}

function formatArg(a) {
  try {
    if (typeof a === "string") return a;
    if (a instanceof Error) return `${a.name}: ${a.message}`;
    return JSON.stringify(a);
  } catch {
    return String(a);
  }
}

// Best-effort: is this fetch part of Next's RSC machinery? Header shapes
// vary (Headers, array, plain object) and the input may be a Request.
function rscMarker(input, init) {
  try {
    const h = init?.headers ?? (input instanceof Request ? input.headers : null);
    if (!h) return "";
    const get = (name) =>
      typeof h.get === "function"
        ? h.get(name)
        : Array.isArray(h)
          ? (h.find(([k]) => k.toLowerCase() === name)?.[1] ?? null)
          : (h[name] ?? h[name.toUpperCase()] ?? h[name.replace(/(^|-)./g, (s) => s.toUpperCase())] ?? null);
    const marks = [];
    if (get("rsc")) marks.push("rsc");
    if (get("next-action")) marks.push("action");
    if (get("next-router-prefetch")) marks.push("prefetch");
    return marks.join("+");
  } catch {
    return "";
  }
}

function installTaps() {
  if (tapsInstalled) return;
  tapsInstalled = true;

  // 1. console.error (v1) — the loud fallback path would land here.
  const originalError = console.error.bind(console);
  console.error = (...args) => {
    const text = args.map(formatArg).join(" ").slice(0, 300);
    if (text) pushEvent({ k: "err", at: Date.now(), text });
    originalError(...args);
  };

  // 2. Every same-origin fetch's fate. Wrap-and-passthrough only: same
  // arguments, same return, body untouched, throws rethrown.
  const originalFetch = window.fetch.bind(window);
  window.fetch = (input, init) => {
    let url = "";
    try {
      url = typeof input === "string" ? input : (input?.url ?? String(input));
    } catch {
      /* leave url empty */
    }
    const local = url.startsWith("/") || url.startsWith(window.location.origin);
    const skip = !local || url.includes("/api/desk-telemetry") || url.includes("/api/avatar/");
    if (skip) return originalFetch(input, init);

    const path = url.replace(window.location.origin, "").slice(0, 80);
    const mark = rscMarker(input, init);
    const started = Date.now();
    return originalFetch(input, init).then(
      (res) => {
        pushEvent({ k: "fetch", at: started, ms: Date.now() - started, path, mark, status: res.status, redirected: res.redirected || undefined, type: res.type });
        return res;
      },
      (err) => {
        pushEvent({ k: "fetchfail", at: started, ms: Date.now() - started, path, mark, error: `${err?.name ?? "?"}: ${String(err?.message ?? err).slice(0, 160)}` });
        throw err;
      },
    );
  };

  // 3. Uncaught errors and unhandled rejections — paths that never touch
  // console.error directly.
  window.addEventListener("error", (e) => {
    pushEvent({ k: "uncaught", at: Date.now(), text: String(e.message ?? "").slice(0, 200) });
  });
  window.addEventListener("unhandledrejection", (e) => {
    const r = e.reason;
    pushEvent({ k: "rejection", at: Date.now(), text: `${r?.name ?? ""}: ${String(r?.message ?? r).slice(0, 200)}` });
  });
}

// The browser's own record of recent fetch/XHR activity — an independent
// cross-check on the tap (a request that failed mid-flight appears with
// transferSize 0 and a truncated duration).
function resourceTail() {
  try {
    return performance
      .getEntriesByType("resource")
      .filter((e) => e.initiatorType === "fetch" || e.initiatorType === "xmlhttprequest")
      .slice(-8)
      .map((e) => ({
        path: e.name.replace(window.location.origin, "").slice(0, 80),
        start: Math.round(e.startTime),
        ms: Math.round(e.duration),
        bytes: e.transferSize,
      }));
  } catch {
    return [];
  }
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
    installTaps();

    // One "landed" report per DOCUMENT (not per mount): how this document
    // arrived, and everything the PREVIOUS document recorded before it died
    // — sessionStorage carries the buffer across the reload.
    if (!landedSent) {
      landedSent = true;
      const nav = performance.getEntriesByType("navigation")[0]?.type ?? "unknown";
      const tail = readSession(TAIL_KEY, null) ?? [];
      writeSession(TAIL_KEY, []); // consumed
      beacon({ kind: "landed", surface, nav, deployVersion, crumb: readVersionCrumb(), tail });
    }

    // Exit report: always send now (v1 skipped when the console tail was
    // empty — and the empty tail turned out to be the interesting case).
    const onPageHide = () => {
      beacon({
        kind: "leaving",
        surface,
        deployVersion,
        tail: readSession(TAIL_KEY, null) ?? [],
        resources: resourceTail(),
      });
    };
    window.addEventListener("pagehide", onPageHide);
    return () => window.removeEventListener("pagehide", onPageHide);
  }, [surface, deployVersion]);
}
