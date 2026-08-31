"use client";

import { useCallback, useSyncExternalStore } from "react";

// A small sessionStorage-backed value, one key at a time, modeled directly on
// usePins.js's localStorage pattern: read through useSyncExternalStore so
// SSR/hydration stays safe (react-hooks/set-state-in-effect is an error in
// this repo — the mandated way to read browser storage is this hook, never
// an effect + setState), JSON-encoded, try/catch around every storage access
// (private window / blocked site data).
//
// sessionStorage rather than localStorage, deliberately: this is per-tab VIEW
// state (a filter, a lens, a toggle) — it should die with the tab, not
// follow a GM to their next session. It DOES survive a same-tab reload,
// which is the point: every deploy hard-reloads the adjudication desk
// (build-id change -> failed RSC fetch -> full navigation), and this repo
// deploys several times a day.
//
// Unlike usePins there is no single fixed key — any number of independent
// values can live under their own key, each with its own subscriber set, all
// sharing one small module-level cache keyed by that string. Two components
// asking for the SAME key share the same live value automatically, exactly
// like two usePins() callers already share "gm-pins".

const listeners = new Map(); // key -> Set<callback>
const cache = new Map(); // key -> { raw, value }

function subscribers(key) {
  let set = listeners.get(key);
  if (!set) {
    set = new Set();
    listeners.set(key, set);
  }
  return set;
}

function parse(raw, fallback) {
  try {
    return raw === null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

// getSnapshot must return the SAME reference until the value actually
// changes — a fresh parse every call is an infinite render loop (same
// discipline usePins.js's own cache follows).
function read(key, fallback) {
  try {
    const raw = window.sessionStorage.getItem(key);
    const cached = cache.get(key);
    if (cached && cached.raw === raw) return cached.value;
    const value = parse(raw, fallback);
    cache.set(key, { raw, value });
    return value;
  } catch {
    return cache.get(key)?.value ?? fallback;
  }
}

function write(key, value) {
  const raw = JSON.stringify(value);
  try {
    window.sessionStorage.setItem(key, raw);
  } catch {
    /* private window / blocked site data — the in-memory cache still updates
       below, so the tab keeps working for its own lifetime even though
       nothing persists. */
  }
  cache.set(key, { raw, value });
  for (const callback of subscribers(key)) callback();
}

// The plain, unsubscribed door to the same store, for state that changes too
// often to be React state — a search box mirrored per keystroke, a scroll
// position written per frame (QueueRail.js's view persistence). readSession
// during render is only hydration-safe if the value doesn't shape the
// hydrated output; to RESTORE something visible, read after hydration (see
// QueueRail.js's one-shot) or use the hook. writeSession still notifies any
// hook subscribed to the key, so keep high-frequency writers on keys nothing
// subscribes to.
export function readSession(key, fallback) {
  return read(key, fallback);
}

export function writeSession(key, value) {
  write(key, value);
}

// `fallback` doubles as the server snapshot AND the value before anything has
// ever been written — pass a stable reference (a module-level constant, the
// same discipline useTableState's own `initialFilters` follows) so
// useSyncExternalStore never sees it change identity between renders.
export default function useSessionState(key, fallback) {
  const subscribe = useCallback(
    (callback) => {
      const set = subscribers(key);
      set.add(callback);
      return () => set.delete(callback);
    },
    [key],
  );
  const getSnapshot = useCallback(() => read(key, fallback), [key, fallback]);
  const getServerSnapshot = useCallback(() => fallback, [fallback]);

  const value = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const setValue = useCallback(
    (updater) => {
      const current = read(key, fallback);
      const next = typeof updater === "function" ? updater(current) : updater;
      write(key, next);
    },
    [key, fallback],
  );

  return [value, setValue];
}
