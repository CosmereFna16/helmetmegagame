"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";

// One pin list, shared by both desks. Pin someone while adjudicating and they
// are pinned when you go talk to them.
//
// The two desks used to keep separate keys in separate identity spaces:
// "desk-pins" held [{ characterId, name }] and "messages-pins" held bare
// ["<discordUserId>"]. That is why this cannot be a rename — an entry carries
// both ids now, and the old keys are migrated once on first read.
//
// Identity is characterId when there is one, discordUserId otherwise. The
// adjudication desk only ever knows a characterId; the player rail knows both,
// so the two agree on anyone who has a character. A player with no character
// pins by discordUserId and never appears on the other desk anyway.

const KEY = "gm-pins";
const LEGACY_DESK_KEY = "desk-pins";
const LEGACY_INBOX_KEY = "messages-pins";

export function pinIdentity(entry) {
  return entry?.characterId ? `c:${entry.characterId}` : `u:${entry?.discordUserId ?? ""}`;
}

function subscribe(callback) {
  window.addEventListener("storage", callback);
  return () => window.removeEventListener("storage", callback);
}

// getSnapshot must return the SAME reference until the value actually changes
// — a fresh array every call is an infinite render loop. So the parse is
// memoized against the raw string it came from.
const NO_PINS = [];
let cache = { raw: null, value: NO_PINS };

function parse(raw) {
  try {
    const parsed = raw ? JSON.parse(raw) : null;
    return Array.isArray(parsed) ? parsed : NO_PINS;
  } catch {
    return NO_PINS;
  }
}

// Runs at most once per tab: if the new key has never been written but either
// old one has, fold them together. Entries from the inbox key have no
// characterId and entries from the desk key have no discordUserId; both halves
// fill in the next time that person is pinned from a surface that knows both.
function migrateLegacy() {
  const desk = parse(window.localStorage.getItem(LEGACY_DESK_KEY))
    .filter((p) => p?.characterId)
    .map((p) => ({ characterId: p.characterId, discordUserId: null, name: p.name ?? "" }));
  const inbox = parse(window.localStorage.getItem(LEGACY_INBOX_KEY))
    .filter((id) => typeof id === "string")
    .map((id) => ({ characterId: null, discordUserId: id, name: "" }));
  const merged = [];
  const seen = new Set();
  for (const entry of [...desk, ...inbox]) {
    const id = pinIdentity(entry);
    if (seen.has(id)) continue;
    seen.add(id);
    merged.push(entry);
  }
  window.localStorage.setItem(KEY, JSON.stringify(merged));
  return merged;
}

function read() {
  try {
    let raw = window.localStorage.getItem(KEY);
    if (raw === null) raw = JSON.stringify(migrateLegacy());
    if (raw === cache.raw) return cache.value;
    cache = { raw, value: parse(raw) };
    return cache.value;
  } catch {
    // private window / blocked site data
    return cache.value;
  }
}

function readServer() {
  return NO_PINS;
}

function write(pins) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(pins));
    // The storage event doesn't fire in the tab that wrote it — nudge the
    // subscriber manually so the pin reflects immediately here too. (The desk
    // used to keep a parallel useState shadow to work around this; it doesn't
    // need one.)
    window.dispatchEvent(new Event("storage"));
  } catch {
    /* private window / blocked site data */
  }
}

export default function usePins() {
  const pins = useSyncExternalStore(subscribe, read, readServer);
  const pinnedIds = useMemo(() => new Set(pins.map(pinIdentity)), [pins]);

  const togglePin = useCallback(
    (entry) => {
      const id = pinIdentity(entry);
      const next = pins.some((p) => pinIdentity(p) === id)
        ? pins.filter((p) => pinIdentity(p) !== id)
        : [...pins, entry];
      write(next);
    },
    [pins],
  );

  const isPinned = useCallback((entry) => pinnedIds.has(pinIdentity(entry)), [pinnedIds]);

  return { pins, pinnedIds, isPinned, togglePin };
}
