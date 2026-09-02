"use client";

import { useCallback, useSyncExternalStore } from "react";

// The live inbox's client store — what LiveInboxPoller.js fills, and what the
// rail and the conversation pane read. A module-level store read through
// useSyncExternalStore, the same shape as useDeskVersion.js and usePins.js,
// rather than a provider: the store is the shared state, so nothing has to be
// wrapped and nothing syncs props into state through an effect.
//
// Two things live here:
//   patches — per conversation, the rail fields that moved (last message time
//             and direction, preview, unread count, handled/muted/claim), each
//             stamped with the DB clock it was read at. The rail lays a patch
//             over its server row only when the patch is newer than the row
//             (mergeRailRows) — a revalidated layout carries a newer stamp,
//             so stale patches simply stop applying. Nothing prunes them in
//             an effect.
//   feeds   — per conversation, the message rows that arrived since the page
//             was seeded. The pane unions them with its own page during
//             render (ConversationPane.js).
//
// Every rebuild makes a new Map/array: useSyncExternalStore notifies on
// reference change, and react-hooks/immutability is an error here.

const EMPTY_PATCHES = new Map();
const EMPTY_FEED = Object.freeze([]);
const SEEN_CAP = 2000;

const state = {
  patches: EMPTY_PATCHES,
  feeds: new Map(),
  cursorMs: 0,
  seen: new Set(),
};
const listeners = new Set();

function emit() {
  for (const cb of listeners) cb();
}

export function subscribe(cb) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function getCursorMs() {
  return state.cursorMs;
}

function getPatches() {
  return state.patches;
}
function getServerPatches() {
  return EMPTY_PATCHES;
}
function getServerFeed() {
  return EMPTY_FEED;
}

function messageTime(m) {
  return new Date(m.createdAt).getTime();
}

function byTimeThenId(a, b) {
  const d = messageTime(a) - messageTime(b);
  if (d !== 0) return d;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

// Folds one poll result in. `sinceMs` is the cursor the request was made
// with (0 on the first tick), and `announce` says whether anything found is
// news — the first tick looks back two minutes at things that were already
// there when the GM arrived, and those must not ring. Returns the INBOUND
// arrivals worth announcing (an id plus the conversation), which is what
// decides whether to chime.
export function applyDelta(delta, { sinceMs = 0, announce = true } = {}) {
  let changed = false;
  const inbound = [];

  if (Number.isFinite(delta?.cursorMs)) state.cursorMs = delta.cursorMs;

  if (Array.isArray(delta?.rail) && delta.rail.length > 0) {
    const next = new Map(state.patches);
    for (const patch of delta.rail) {
      if (!patch?.discordUserId) continue;
      next.set(patch.discordUserId, { ...patch, asOfMs: delta.nowMs });
    }
    state.patches = next;
    changed = true;
  }

  const thread = delta?.thread;
  if (thread?.discordUserId && Array.isArray(thread.messages) && thread.messages.length > 0) {
    const fresh = thread.messages.filter((m) => m?.id && !state.seen.has(m.id));
    if (fresh.length > 0) {
      for (const m of fresh) {
        state.seen.add(m.id);
        if (announce && m.direction === "INBOUND") {
          inbound.push({ id: m.id, discordUserId: thread.discordUserId });
        }
      }
      const current = state.feeds.get(thread.discordUserId) ?? EMPTY_FEED;
      const merged = Object.freeze([...current, ...fresh].sort(byTimeThenId));
      const feeds = new Map(state.feeds);
      feeds.set(thread.discordUserId, merged);
      state.feeds = feeds;
      changed = true;
    }
  }

  // Inbound rows on conversations that are NOT open never reach `feeds` (the
  // server only ships the open thread), so the chime hears about them from
  // the rail patch instead. A conversation can be in the patch set for other
  // reasons too (its read cursor moved), so "inbound" alone isn't news —
  // only an inbound last message newer than the cursor we asked with is.
  if (announce && Array.isArray(delta?.rail)) {
    for (const patch of delta.rail) {
      if (patch?.lastDirection !== "INBOUND") continue;
      if (patch.discordUserId === thread?.discordUserId) continue;
      if (!(patch.lastAtMs > sinceMs)) continue;
      const key = `rail:${patch.discordUserId}:${patch.lastAtMs}`;
      if (state.seen.has(key)) continue;
      state.seen.add(key);
      inbound.push({ id: key, discordUserId: patch.discordUserId });
    }
  }

  if (state.seen.size > SEEN_CAP) {
    state.seen = new Set([...state.seen].slice(-SEEN_CAP));
  }

  if (changed) emit();
  return { inbound };
}

export function useRailPatches() {
  return useSyncExternalStore(subscribe, getPatches, getServerPatches);
}

export function useThreadFeed(discordUserId) {
  const snap = useCallback(() => state.feeds.get(discordUserId) ?? EMPTY_FEED, [discordUserId]);
  return useSyncExternalStore(subscribe, snap, getServerFeed);
}

// Lays the live patches over the layout's rows. A patch applies as a whole or
// not at all — its fields came from one consistent read, and mixing half of
// it with half a row could say "handled" against a newer message. A patch
// for someone the rail has never seen (a guild member with no character who
// just wrote for the first time) carries a whole `row` to append.
export function mergeRailRows(rows, patches, rowsAsOfMs) {
  if (!patches || patches.size === 0) return rows;
  const known = new Set();
  const merged = rows.map((r) => {
    known.add(r.discordUserId);
    const p = patches.get(r.discordUserId);
    if (!p || !(p.asOfMs > rowsAsOfMs)) return r;
    const { asOfMs: _asOf, row: _row, ...fields } = p;
    void _asOf;
    void _row;
    return { ...r, ...fields };
  });
  for (const [id, p] of patches) {
    if (known.has(id) || !(p.asOfMs > rowsAsOfMs) || !p.row) continue;
    const { asOfMs: _asOf, row, ...fields } = p;
    void _asOf;
    merged.push({ ...row, ...fields });
  }
  return merged;
}
