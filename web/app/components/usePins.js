"use client";

import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";

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

// `knownIdentities`, if given, is a Set of pinIdentity() strings this caller
// can vouch for (e.g. the live roster). Any pin whose identity falls in the
// SAME namespace ("c:" or "u:") as an entry in that set, but isn't actually
// in it, is dead — most often because a game wipe deleted every Character
// row out from under a stale localStorage chip. Such pins are dropped from
// what's returned and the prune is written back once. A pin in a namespace
// the caller doesn't know about (e.g. a "u:" player-only pin, seen from the
// adjudication desk which only ever knows characters) is left alone — the
// caller can't tell a live one from a dead one, so it stays for whichever
// desk does know.
export default function usePins({ knownIdentities } = {}) {
  const rawPins = useSyncExternalStore(subscribe, read, readServer);

  const pins = useMemo(() => {
    if (!knownIdentities) return rawPins;
    return rawPins.filter((p) => {
      const id = pinIdentity(p);
      const namespace = id.slice(0, 2); // "c:" or "u:"
      const knownInNamespace = [...knownIdentities].some((k) => k.startsWith(namespace));
      if (!knownInNamespace) return true; // caller can't judge this namespace
      return knownIdentities.has(id);
    });
  }, [rawPins, knownIdentities]);

  useEffect(() => {
    if (!knownIdentities) return;
    if (pins.length !== rawPins.length) write(pins);
  }, [pins, rawPins, knownIdentities]);

  const pinnedIds = useMemo(() => new Set(pins.map(pinIdentity)), [pins]);

  const togglePin = useCallback(
    (entry) => {
      const id = pinIdentity(entry);
      const next = rawPins.some((p) => pinIdentity(p) === id)
        ? rawPins.filter((p) => pinIdentity(p) !== id)
        : [...rawPins, entry];
      write(next);
    },
    [rawPins],
  );

  const isPinned = useCallback((entry) => pinnedIds.has(pinIdentity(entry)), [pinnedIds]);

  return { pins, pinnedIds, isPinned, togglePin };
}
