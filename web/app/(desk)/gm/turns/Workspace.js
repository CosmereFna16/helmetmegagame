"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import useSessionState from "@/app/components/useSessionState";
import { DeskStaleRefreshGate, DeskStaleChip } from "@/app/components/useDeskVersion";
import useGatedRefreshPoll from "@/app/components/useGatedRefreshPoll";
import useReloadTelemetry from "@/app/components/useReloadTelemetry";
import QueueRail, { RAIL_STORAGE_KEY, RAIL_STORAGE_DEFAULT } from "./QueueRail";
import MoveDesk from "./MoveDesk";
import MoveHistoryDesk from "./MoveHistoryDesk";
import RequestDesk from "./RequestDesk";
import CavingDesk from "./CavingDesk";
import { getMoveHistory } from "./actions";
import InspectorColumn from "@/app/components/InspectorColumn";
import StagingTray from "./StagingTray";
import PushPreview from "./PushPreview";
import DevPanelModal from "@/app/components/DevPanelModal";
import DeskHeader from "@/app/components/DeskHeader";
import { isAnyDirty } from "@/app/components/useDirtyGuard";
import { useConfirm } from "@/app/components/ConfirmProvider";
import usePins from "@/app/components/usePins";
import { useIsCoarsePointer } from "@/app/components/useIsCoarsePointer";
import { isFieldFocused } from "@/lib/deskKeyGuard";

// The adjudication workspace's client shell — mission control. It owns three
// pieces of state: selection (which Move/Request the desk shows), inspector
// (which character the right column looks at, plus pins), and preview
// (whether the push-preview dialog is open).
//
// Everything it renders is a DTO from page.js; every mutation lives in a
// child that calls a server action and router.refresh()es. The full-viewport
// .desk-* layout is this page's own sanctioned deviation (DESIGN-SYSTEM.md).

const REFRESH_MS = 45_000;

// Click-frequency view state that should survive a reload, sibling to
// QueueRail's RAIL_STORAGE_KEY under the same useSessionState store. Split
// from the rail key so the two subscriber sets stay independent, and split
// from QueueRail's keystroke/scroll-frequency "gm-turns-view" key (which is
// deliberately UNsubscribed — see useSessionState.js#readSession).
const DESK_STORAGE_KEY = "gm-turns-desk";
const DESK_STORAGE_DEFAULT = {
  trayOpen: false,
  trayExpanded: false,
  inspected: null, // { characterId, name }
  historyTurnId: null,
};

const CT_PARTS = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Chicago",
  hour12: false,
  hour: "numeric",
  minute: "numeric",
});

// Minutes until the next 12:00 or 00:00 America/Chicago, computed off the
// wall-clock parts rather than any DST math — Intl already resolved the
// offset for us. Chicago's "24:00" formatToParts quirk (midnight can render
// as hour 24) is normalized to 0.
function minutesUntilNextPush() {
  const parts = CT_PARTS.formatToParts(new Date());
  const h = Number(parts.find((p) => p.type === "hour")?.value ?? 0) % 24;
  const m = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  const sinceMidnight = h * 60 + m;
  const sinceLastBoundary = sinceMidnight % (12 * 60);
  const untilNext = 12 * 60 - sinceLastBoundary;
  return untilNext === 12 * 60 ? 0 : untilNext;
}

function formatCountdown(minutes) {
  if (minutes <= 0) return "Push imminent";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h <= 0) return `Push in ${m}m`;
  return `Push in ${h}h ${m}m`;
}

// The last stretch of a turn, when players can no longer send a Move
// (TURN-ENGINE.md — db/lib/turnClock.js#moveWindow is the one definition, and
// it is resolved server-side in page.js because it lives in db/lib). Absent
// entirely when the turn has no lock at all: auto-advance switched off, or a
// manually advanced turn too short to carry a three-hour cutoff.
function formatMoveLock(cutoffAtMs, nowMs) {
  const mins = Math.round((cutoffAtMs - nowMs) / 60_000);
  if (mins <= 0) return "moves locked";
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h <= 0 ? `moves lock in ${m}m` : `moves lock in ${h}h ${m}m`;
}

// Selection is mirrored into the URL as /gm/turns/<type>/<id>, so a refresh
// keeps your seat and a GM can send another GM a link to the exact Move.
function selectionHref(sel) {
  return sel ? `/gm/turns/${sel.type}/${sel.id}` : "/gm/turns";
}

// A selected history row can belong to a turn other than the one the picker is
// on — a GM opens a Move, then changes the turn — so this looks across every
// turn already loaded, and falls back to the one row page.js preloaded for a
// deep link when the lens hasn't fetched anything yet.
function findHistoryMove(historyByTurn, moveId, preloaded) {
  for (const [turnId, entry] of historyByTurn) {
    const move = entry.moves.find((m) => m.id === moveId);
    if (!move) continue;
    return {
      turnId,
      move,
      effects: entry.effects.filter((e) => e.moveId === moveId),
      messages: entry.messages.filter((m) => m.moveId === moveId),
      tagsById: entry.tagsById,
    };
  }
  return preloaded?.move?.id === moveId ? preloaded : null;
}

// The Caving twin of findHistoryMove: a selected caving roll may sit on a turn
// other than the one the picker is on, so look across every loaded turn, then
// fall back to the one roll page.js preloaded for a /gm/turns/caving/<id> deep
// link.
function findHistoryCaving(historyByTurn, rollId, preloaded) {
  for (const [turnId, entry] of historyByTurn) {
    const roll = (entry.cavingRolls ?? []).find((c) => c.id === rollId);
    if (!roll) continue;
    return {
      turnId,
      roll,
      effects: entry.effects.filter((e) => e.cavingRollId === rollId),
      messages: entry.messages.filter((m) => m.cavingRollId === rollId),
    };
  }
  return preloaded?.roll?.id === rollId ? preloaded : null;
}

// The history entry’s staged rows keyed by Move, the same shape Workspace
// builds for the open turn — a plain function rather than a useMemo because
// its input is derived from a cache the render itself can evict.
function groupByMove(entry) {
  const map = new Map();
  if (!entry) return map;
  for (const e of entry.effects) {
    if (!e.moveId) continue;
    const row = map.get(e.moveId) ?? { effects: [], messages: [] };
    row.effects.push(e);
    map.set(e.moveId, row);
  }
  for (const m of entry.messages) {
    if (!m.moveId) continue;
    const row = map.get(m.moveId) ?? { effects: [], messages: [] };
    row.messages.push(m);
    map.set(m.moveId, row);
  }
  return map;
}

// The unapplied staged rows, as one comparable string. Only id plus the fields
// an edit can actually change — a poll that returns the same rows produces the
// same string, so the history cache survives it.
function fingerprintUnapplied(effects, messages) {
  const parts = [];
  for (const e of effects) {
    if (e.applied) continue;
    parts.push(
      `e:${e.id}:${e.resources}:${e.tagPoints}:${e.zoneId ?? ""}:${JSON.stringify(e.tagOps ?? [])}`,
    );
  }
  for (const m of messages) {
    if (m.sent) continue;
    const to = m.recipients.map((r) => r.characterId).join(",");
    parts.push(`m:${m.id}:${m.kind}:${m.zoneId ?? ""}:${to}:${m.content}`);
  }
  return parts.join("|");
}

export default function Workspace({
  initialSelection,
  initialHistory,
  initialCaving,
  resolvedTurns,
  openTurn,
  myZoneNames,
  tagsById,
  tagCatalog,
  roster,
  presenceZones,
  factions,
  moves,
  requests,
  cavingRolls,
  stagedEffects,
  stagedMessages,
  gmProfiles,
  moveLock,
  deployVersion,
}) {
  // Click-frequency view state that survives a reload — see
  // DESK_STORAGE_DEFAULT above for what lives here.
  const [desk, setDesk] = useSessionState(DESK_STORAGE_KEY, DESK_STORAGE_DEFAULT);
  // The rail's lens, persisted under the same sessionStorage key QueueRail.js
  // reads its filters and travel toggles from (RAIL_STORAGE_KEY).
  const [rail, setRail] = useSessionState(RAIL_STORAGE_KEY, RAIL_STORAGE_DEFAULT);
  // A /gm/turns/history/<id> link arrives with the rail already on History,
  // so that has to win over whatever lens was persisted from an earlier
  // session. A one-shot correction, not a perpetual override — set at render
  // time (same pattern as StagingTray.js's revealSignal), never in an effect
  // (react-hooks/set-state-in-effect is an error here).
  const [seenDeepLinkId, setSeenDeepLinkId] = useState(null);
  if (
    typeof window !== "undefined" &&
    initialSelection?.type === "history" &&
    seenDeepLinkId !== initialSelection.id
  ) {
    setSeenDeepLinkId(initialSelection.id);
    if (rail.lens !== "history") setRail((r) => ({ ...r, lens: "history" }));
    // The deep link names a turn too — it beats whatever turn the persisted
    // desk state still remembers, by the same one-shot rule as the lens.
    if (initialHistory?.turnId && desk.historyTurnId !== initialHistory.turnId) {
      setDesk((d) => ({ ...d, historyTurnId: initialHistory.turnId }));
    }
  }
  // The Caving twin of the deep link above. page.js sets initialCaving ONLY for
  // a roll on a resolved turn (an open-turn roll is already in the live
  // cavingRolls prop and opens on the live Caving lens), so its presence is the
  // signal to swing the History lens onto Caving and that roll's turn.
  if (
    typeof window !== "undefined" &&
    initialSelection?.type === "caving" &&
    initialCaving &&
    seenDeepLinkId !== initialSelection.id
  ) {
    setSeenDeepLinkId(initialSelection.id);
    if (rail.lens !== "history" || rail.historyKind !== "caving") {
      setRail((r) => ({ ...r, lens: "history", historyKind: "caving" }));
    }
    if (initialCaving.turnId && desk.historyTurnId !== initialCaving.turnId) {
      setDesk((d) => ({ ...d, historyTurnId: initialCaving.turnId }));
    }
  }
  const lens = rail.lens ?? "moves";
  const setLens = useCallback((l) => setRail((r) => ({ ...r, lens: l })), [setRail]);
  const historyKind = rail.historyKind ?? "moves";
  const setHistoryKind = useCallback((k) => setRail((r) => ({ ...r, historyKind: k })), [setRail]);
  const [selected, setSelected] = useState(initialSelection ?? null); // { type: "move"|"request"|"caving"|"history", id }

  // The URL mirrors `selected`; it is never its source after the first paint.
  // replaceState is Next's documented escape hatch: it syncs the router
  // without fetching an RSC payload, so picking a row leaves the queue, every
  // DTO, the inspector cache and the tray exactly as they were. A router.push
  // here would reload the whole desk on every click. replaceState, not
  // pushState, so Back leaves the desk rather than walking selection history.
  const confirm = useConfirm();
  // A fresh `select` must go through the same dirty guard as Close/Escape —
  // isAnyDirty() is the cross-component flag the 45s poll also reads
  // (useDirtyGuard.js).
  const select = useCallback(
    async (sel) => {
      if (isAnyDirty()) {
        const ok = await confirm({
          title: "Discard your changes?",
          message: "This panel has unsaved edits. Switching rows reverts every change you've made.",
          confirmLabel: "Discard",
          cancelLabel: "Keep editing",
        });
        if (!ok) return;
      }
      setSelected(sel);
      window.history.replaceState(null, "", selectionHref(sel));
    },
    [confirm],
  );
  const deselect = useCallback(() => select(null), [select]);
  // Who the inspector column is looking at — persisted (gm-turns-desk) so a
  // deploy-forced reload doesn't blank the person you were cross-referencing.
  // Deliberately NOT validated against the roster: the roster is ALIVE-only,
  // and inspecting the dead is a feature (a History-lens actor, a character
  // killed this turn). An id a game wipe deleted outright just renders the
  // column's own "Couldn't load that." and the next click replaces it.
  const setInspected = useCallback(
    (v) =>
      setDesk((d) => ({
        ...d,
        inspected: typeof v === "function" ? v(d.inspected ?? null) : v,
      })),
    [setDesk],
  );
  const inspected = desk.inspected ?? null;
  const [tabRequest, setTabRequest] = useState(null); // { tab, token } — see inspect()
  // One pin list shared with the player desk — see usePins.js. This desk only
  // ever knows characters, so it prunes the "c:" namespace against the live
  // roster (dead after a game wipe, or a character deleted outright) and
  // leaves any "u:" player-only pin alone for the player desk to judge.
  const knownPinIdentities = useMemo(() => new Set(roster.map((c) => `c:${c.id}`)), [roster]);
  const { pins: pinned, togglePin } = usePins({ knownIdentities: knownPinIdentities });
  const [previewOpen, setPreviewOpen] = useState(false);
  // { characterId, name } of the Dev Panel currently open as a modal over
  // the desk, or null. Opening it never leaves /gm/turns or resets any of
  // the state above.
  const [devPanel, setDevPanel] = useState(null);
  const onOpenDev = useCallback((characterId, name) => setDevPanel({ characterId, name }), []);

  // The push tray's open/expanded state is lifted here (rather than local to
  // StagingTray) so the interactive push preview can force it open and
  // scroll to a row (revealStagedRow below) — and persisted (gm-turns-desk)
  // so a reload hands back the tray the way you left it.
  const trayOpen = desk.trayOpen ?? false;
  const trayExpanded = desk.trayExpanded ?? false;
  const setTrayOpen = useCallback(
    (v) =>
      setDesk((d) => ({
        ...d,
        trayOpen: typeof v === "function" ? v(d.trayOpen ?? false) : v,
      })),
    [setDesk],
  );
  const setTrayExpanded = useCallback(
    (v) =>
      setDesk((d) => ({
        ...d,
        trayExpanded: typeof v === "function" ? v(d.trayExpanded ?? false) : v,
      })),
    [setDesk],
  );
  const [revealSignal, setRevealSignal] = useState(null); // { id, token }

  const revealStagedRow = useCallback(
    (id) => {
      setPreviewOpen(false);
      setTrayOpen(true);
      setTrayExpanded(true);
      setRevealSignal({ id, token: Date.now() });
    },
    [setTrayOpen, setTrayExpanded],
  );

  // Escape is layered, topmost-first, and this is the bottom layer:
  //   1. An open Modal (confirm, composer, reject dialog) — Modal.js handles
  //      its own Escape; we just yield when one is on screen.
  //   2. A focused input/textarea/select — blur it, don't blow away the desk.
  //   3. A selected Move/Request — deselect through the desk's own dirty
  //      guard (registerEscape), so unsaved edits still prompt.
  // With nothing selected, Escape does nothing — the nav rail is how you
  // leave the desk, never Escape.
  // One window listener, stable deps, live state read through refs so it
  // never needs to re-bind.
  const selectedRef = useRef(null);
  useEffect(() => {
    selectedRef.current = selected;
  }, [selected]);

  const deskEscapeRef = useRef(null);
  const registerEscape = useCallback((fn) => {
    deskEscapeRef.current = fn;
  }, []);

  const coarse = useIsCoarsePointer();

  useEffect(() => {
    // No Escape key on a touch-primary device — skip wiring the listener
    // (also stops a stray Escape from navigating away on mobile).
    if (coarse) return undefined;
    function onKey(e) {
      if (e.key !== "Escape") return;
      if (document.querySelector(".modal-overlay")) return;
      const active = document.activeElement;
      // A Select's own Escape (Select.js) already closes its popup and
      // stopPropagation()s — so reaching here with a combobox/listbox
      // focused means there was no popup open, and this Escape is free to
      // fall through to the desk's own layer, same as any other field.
      if (isFieldFocused(active)) {
        active.blur?.();
        return;
      }
      if (selectedRef.current) {
        deskEscapeRef.current?.();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [coarse]);

  // Inspector fetches are cached for the life of the page view, keyed
  // `${characterId}:${tab}`. State rather than a ref because the entries are
  // read during render (react-hooks/refs is an error here); updates replace
  // the Map immutably — see InspectorColumn.
  const [inspectorCache, setInspectorCache] = useState(() => new Map());

  // The History lens's rows, one resolved turn per entry, fetched on demand
  // and kept for the life of the page view. State rather than a ref because
  // it is read during render; the setCache lands AFTER the await, never
  // synchronously in the effect body (react-hooks/set-state-in-effect).
  const [historyByTurn, setHistoryByTurn] = useState(() => new Map());
  // The History lens's turn — persisted (gm-turns-desk), validated against
  // the turns that still exist, deep link wins via the one-shot above.
  // Falls back to the preloaded deep-link turn, else the newest resolved one.
  //
  // The dropdown's list: the OPEN turn first, then every resolved turn
  // newest-first. Labels come from page.js's one turnLabel() for both halves
  // — the only thing added here is the "· open" suffix, so a GM can tell the
  // live turn from a pushed one at a glance.
  const historyTurnOptions = useMemo(() => {
    const opts = openTurn ? [{ id: openTurn.id, label: `${openTurn.label} · open` }] : [];
    for (const t of resolvedTurns ?? []) opts.push({ id: t.id, label: t.label });
    return opts;
  }, [openTurn, resolvedTurns]);
  const storedHistoryTurnId = desk.historyTurnId ?? null;
  // Validated against the whole option list, open turn included — otherwise a
  // GM parked on the open turn would have the selection thrown away on every
  // reload and land back on the newest resolved turn.
  const historyTurnId =
    storedHistoryTurnId && historyTurnOptions.some((t) => t.id === storedHistoryTurnId)
      ? storedHistoryTurnId
      : (initialHistory?.turnId ?? resolvedTurns?.[0]?.id ?? null);
  // When the picker is on the open turn the lens reads the LIVE props this
  // page already ships instead of the history cache — no fetch, no second
  // copy of the same rows to drift.
  //
  // When the turn advances under a GM sitting here, this just flips false on
  // the next poll: the id it holds is by then a RESOLVED turn, so it passes
  // the validation above unchanged and the effect below fetches it like any
  // other past turn. A row that was selected as a live `move` falls out of
  // `moves` at the same moment and the desk shows its "that row isn't in the
  // open turn's queue any more" empty state, which is exactly what happened.
  const historyIsOpenTurn = Boolean(openTurn && historyTurnId === openTurn.id);
  const setHistoryTurnId = useCallback(
    (turnId) => setDesk((d) => ({ ...d, historyTurnId: turnId })),
    [setDesk],
  );
  const [historyError, setHistoryError] = useState(null);

  // The cache has to be invalidated when a staged row on a past turn is
  // edited or deleted from the history desk: router.refresh() re-runs page.js
  // but never getMoveHistory, so without this a deleted message keeps
  // rendering until a hard reload. page.js already ships every UNAPPLIED
  // staged row regardless of turn, so a change to that set is the signal —
  // taken during render, not from an effect, same as InspectorColumn's tab
  // request.
  const stagedFingerprint = useMemo(
    () => fingerprintUnapplied(stagedEffects, stagedMessages),
    [stagedEffects, stagedMessages],
  );
  // Marked stale rather than dropped: dropping would blink the open desk
  // through the empty state while the refetch was in flight, and this desk's
  // whole point is that it doesn't yank things out from under a GM.
  const [lastStagedFingerprint, setLastStagedFingerprint] = useState(stagedFingerprint);
  let historyCache = historyByTurn;
  if (stagedFingerprint !== lastStagedFingerprint) {
    historyCache = new Map();
    for (const [id, entry] of historyByTurn) historyCache.set(id, { ...entry, stale: true });
    setLastStagedFingerprint(stagedFingerprint);
    setHistoryByTurn(historyCache);
  }

  // The open turn's rows are the live ones page.js already shipped — the same
  // arrays the Moves lens, the tray and the push preview render from, so the
  // two lenses can never disagree. Every other turn comes out of the cache.
  const historyEntry = historyIsOpenTurn
    ? { moves, cavingRolls, effects: stagedEffects, messages: stagedMessages, tagsById }
    : historyTurnId
      ? (historyCache.get(historyTurnId) ?? null)
      : null;
  const historyLoading =
    !historyIsOpenTurn && lens === "history" && Boolean(historyTurnId) && !historyEntry && !historyError;

  useEffect(() => {
    // getMoveHistory guards on RESOLVED (actions.js) and would refuse the open
    // turn anyway — but the point is that it is never asked: the live props are
    // already here.
    if (historyIsOpenTurn) return undefined;
    if (lens !== "history" || !historyTurnId) return undefined;
    const cached = historyByTurn.get(historyTurnId);
    if (cached && !cached.stale) return undefined;
    let cancelled = false;
    (async () => {
      const res = await getMoveHistory({ turnId: historyTurnId });
      if (cancelled) return;
      if (!res?.ok) {
        setHistoryError(res?.error ?? "Couldn't load that turn.");
        return;
      }
      setHistoryError(null);
      setHistoryByTurn((prev) =>
        new Map(prev).set(historyTurnId, {
          moves: res.moves,
          cavingRolls: res.cavingRolls,
          effects: res.effects,
          messages: res.messages,
          tagsById: res.tagsById,
        }),
      );
    })().catch(() => {
      // guarded() only converts a UserError into a result; anything else comes
      // back out as a rejection. Without this the rail sits on "Loading that
      // turn…" for good.
      if (!cancelled) setHistoryError("Couldn't load that turn.");
    });
    return () => {
      cancelled = true;
    };
  }, [lens, historyTurnId, historyByTurn, historyIsOpenTurn]);

  const pickHistoryTurn = useCallback(
    (turnId) => {
      setHistoryError(null);
      setHistoryTurnId(turnId);
    },
    [setHistoryTurnId],
  );

  // Identical shape either way: on the open turn `historyEntry` already holds
  // the live stagedEffects/stagedMessages, so this rebuilds exactly what
  // stagedByMove below builds.
  const historyStagedByMove = groupByMove(historyEntry);

  const selectedHistory =
    selected?.type === "history" ? findHistoryMove(historyCache, selected.id, initialHistory) : null;

  // Tag chips need the catalog entry for every tag on screen, and a past
  // turn's Moves carry tags nobody on the open turn holds.
  const allTagsById = useMemo(() => {
    const merged = { ...tagsById };
    if (initialHistory?.tagsById) Object.assign(merged, initialHistory.tagsById);
    for (const entry of historyCache.values()) Object.assign(merged, entry.tagsById);
    return merged;
  }, [tagsById, historyCache, initialHistory]);

  const historyTurnLabel =
    resolvedTurns?.find((t) => t.id === selectedHistory?.turnId)?.label ?? null;

  const selectedMove = selected?.type === "move" ? moves.find((m) => m.id === selected.id) : null;
  const selectedRequest = selected?.type === "request" ? requests.find((r) => r.id === selected.id) : null;
  // A caving selection resolves against the LIVE open-turn rolls first; a roll
  // that isn't there is a History-lens pick, found across every loaded turn (or
  // the deep-link preload). The URL type stays "caving" for both, so
  // /gm/turns/caving/<id> means the roll whichever turn it sits on.
  const liveCaving =
    selected?.type === "caving" ? (cavingRolls ?? []).find((c) => c.id === selected.id) : null;
  const historyCaving =
    selected?.type === "caving" && !liveCaving
      ? findHistoryCaving(historyCache, selected.id, initialCaving)
      : null;
  const selectedCaving = liveCaving ?? historyCaving?.roll ?? null;
  const selectedCavingIsLive = Boolean(liveCaving);
  const selectedCavingTurnLabel = historyCaving
    ? (resolvedTurns?.find((t) => t.id === historyCaving.turnId)?.label ?? null)
    : null;

  // The inspector's dim/suffix source for staged quick-edits: net staged
  // resources/tag points and pending tag ops, per character, over everything
  // not yet applied by a push.
  const pendingByCharacter = useMemo(() => {
    const map = new Map();
    for (const e of stagedEffects) {
      if (e.applied) continue;
      const entry = map.get(e.targetCharacterId) ?? { resources: 0, tagPoints: 0, removes: new Set(), adds: new Set() };
      entry.resources += e.resources ?? 0;
      entry.tagPoints += e.tagPoints ?? 0;
      for (const op of e.tagOps ?? []) (op.op === "remove" ? entry.removes : entry.adds).add(op.tagId);
      map.set(e.targetCharacterId, entry);
    }
    return map;
  }, [stagedEffects]);

  const stagedByMove = useMemo(() => {
    const map = new Map();
    for (const e of stagedEffects) {
      if (!e.moveId) continue;
      const entry = map.get(e.moveId) ?? { effects: [], messages: [] };
      entry.effects.push(e);
      map.set(e.moveId, entry);
    }
    for (const m of stagedMessages) {
      if (!m.moveId) continue;
      const entry = map.get(m.moveId) ?? { effects: [], messages: [] };
      entry.messages.push(m);
      map.set(m.moveId, entry);
    }
    return map;
  }, [stagedEffects, stagedMessages]);

  // Same shape as stagedByMove, keyed by cavingRollId instead — a GM can
  // stage narration and effects against a Caving Die roll exactly as
  // against a Move (see CavingDesk.js).
  const stagedByCaving = useMemo(() => {
    const map = new Map();
    for (const e of stagedEffects) {
      if (!e.cavingRollId) continue;
      const entry = map.get(e.cavingRollId) ?? { effects: [], messages: [] };
      entry.effects.push(e);
      map.set(e.cavingRollId, entry);
    }
    for (const m of stagedMessages) {
      if (!m.cavingRollId) continue;
      const entry = map.get(m.cavingRollId) ?? { effects: [], messages: [] };
      entry.messages.push(m);
      map.set(m.cavingRollId, entry);
    }
    return map;
  }, [stagedEffects, stagedMessages]);

  const solvedCount = moves.filter((m) => m.reviewStatus === "SOLVED").length;

  // The inspector's custom-tag door. It defaults to STAGING here: this desk
  // is mid-push, so a tag invented while chasing a Move belongs in the tray
  // rather than landing live. TAG_CHIP_FIELDS carries no group id, so the
  // dialog drops its Group picker rather than offering one it can't resolve.
  const customTag = useMemo(
    () => ({
      mode: "stage",
      categories: [...new Set(tagCatalog.map((t) => t.category))].sort((a, b) => a.localeCompare(b)),
      tags: tagCatalog,
    }),
    [tagCatalog],
  );

  // The optional third argument is a tab REQUEST, not a controlled value: the
  // "Past moves" buttons want to land on Moves, but a GM must still be free to
  // click away afterwards. The token is what tells the inspector this is a new
  // ask rather than the one it already honoured — see InspectorColumn.
  function inspect(characterId, name, tab) {
    if (!characterId) return;
    setInspected({ characterId, name });
    if (tab) setTabRequest((prev) => ({ tab, token: (prev?.token ?? 0) + 1 }));
  }

  // Live queue refresh — the shared gated poll (visible / no modal / not
  // dirty / same build, see useGatedRefreshPoll.js). The version half is the
  // anti-yank guard: a router.refresh() against a build other than the one
  // this page rendered from trips Next's full-navigation mismatch fallback,
  // so a deploy latches the reload chip below instead.
  const lastRefreshedAt = useGatedRefreshPoll(REFRESH_MS, deployVersion);

  // Every document load beacons the PREVIOUS page's death report (nav type,
  // console tail, version crumb) into the server logs — the desk keeps
  // hard-reloading in ways only classifiable from the client's last words.
  // Temporary; see useReloadTelemetry.js.
  useReloadTelemetry("turns", deployVersion);

  // Countdown to the next noon/midnight CT push, ticking every 30s. The move
  // cutoff rides the same tick.
  const [pushMinutes, setPushMinutes] = useState(() => minutesUntilNextPush());
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => {
      setPushMinutes(minutesUntilNextPush());
      setNowMs(Date.now());
    }, 30_000);
    return () => clearInterval(id);
  }, []);

  return (
    // Once a deploy latches `stale`, every refresh under this gate — the
    // post-Solve/staging ones included — skips instead of hard-reloading
    // the desk across the build boundary. The chip in the header is the way
    // forward from there.
    <DeskStaleRefreshGate>
    <div className="desk-shell">
      <DeskHeader
        title="Adjudication"
        meta={
          <>
            <span className="chip">
              {openTurn ? `Turn ${openTurn.number} · ${openTurn.phase === "DAWN" ? "Dawn" : "Dusk"}` : "No turn open"}
            </span>
            <span className="chip text-xs text-muted">{solvedCount}/{moves.length} solved</span>
            <span className="text-xs text-muted" title="Push fires at noon & midnight CT">
              {formatCountdown(pushMinutes)}
              {moveLock ? ` · ${formatMoveLock(moveLock.cutoffAtMs, nowMs)}` : ""}
            </span>
            {lastRefreshedAt && (
              <span className="text-xs text-muted">
                updated {lastRefreshedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              </span>
            )}
            {/* isAnyDirty() is a plain module counter, not React state — read
                at render time the same way the poll interval reads it at fire
                time. It drifts by at most one 30s tick, which is fine for a
                status line: without this, a Result box left mid-sentence
                silently froze the queue, tray counts and missed-push banner
                for the rest of the session with no on-screen sign of it. */}
            {isAnyDirty() && <span className="text-xs text-accent">paused — unsaved edits</span>}
          </>
        }
        actions={
          <>
            <DeskStaleChip />
            <button type="button" className="btn-quiet" onClick={() => setPreviewOpen(true)}>
              Preview push
            </button>
          </>
        }
      />

      <div className="desk-body">
        <QueueRail
          moves={moves}
          requests={requests}
          cavingRolls={cavingRolls}
          myZoneNames={myZoneNames}
          stagedByMove={stagedByMove}
          selected={selected}
          onSelect={select}
          lens={lens}
          onLens={setLens}
          gmProfiles={gmProfiles}
          tagsById={allTagsById}
          historyTurnOptions={historyTurnOptions}
          historyIsOpenTurn={historyIsOpenTurn}
          historyTurnId={historyTurnId}
          onHistoryTurn={pickHistoryTurn}
          historyMoves={historyEntry?.moves ?? []}
          historyStagedByMove={historyStagedByMove}
          historyKind={historyKind}
          onHistoryKind={setHistoryKind}
          historyCavingRolls={historyEntry?.cavingRolls ?? []}
          historyLoading={historyLoading}
          historyError={historyError}
        />

        <main className="desk-main">
          {selectedMove ? (
            <MoveDesk
              key={selectedMove.id}
              move={selectedMove}
              staged={stagedByMove.get(selectedMove.id) ?? { effects: [], messages: [] }}
              tagsById={tagsById}
              tagCatalog={tagCatalog}
              roster={roster}
              presenceZones={presenceZones}
              currentTurnNumber={openTurn?.number ?? null}
              onInspect={inspect}
              onClose={deselect}
              registerEscape={registerEscape}
              onOpenDev={onOpenDev}
              gmProfiles={gmProfiles}
            />
          ) : selectedRequest ? (
            <RequestDesk
              key={selectedRequest.id}
              request={selectedRequest}
              onInspect={inspect}
              onClose={deselect}
              registerEscape={registerEscape}
              onOpenDev={onOpenDev}
            />
          ) : selectedHistory ? (
            <MoveHistoryDesk
              key={selectedHistory.move.id}
              move={selectedHistory.move}
              turnLabel={historyTurnLabel}
              staged={{ effects: selectedHistory.effects, messages: selectedHistory.messages }}
              tagsById={allTagsById}
              tagCatalog={tagCatalog}
              roster={roster}
              presenceZones={presenceZones}
              currentTurnNumber={openTurn?.number ?? null}
              onInspect={inspect}
              onClose={deselect}
              registerEscape={registerEscape}
              onOpenDev={onOpenDev}
              gmProfiles={gmProfiles}
            />
          ) : selectedCaving ? (
            <CavingDesk
              key={selectedCaving.id}
              roll={selectedCaving}
              readOnly={!selectedCavingIsLive}
              turnLabel={selectedCavingTurnLabel}
              staged={
                selectedCavingIsLive
                  ? (stagedByCaving.get(selectedCaving.id) ?? { effects: [], messages: [] })
                  : { effects: historyCaving?.effects ?? [], messages: historyCaving?.messages ?? [] }
              }
              tagsById={tagsById}
              tagCatalog={tagCatalog}
              roster={roster}
              presenceZones={presenceZones}
              currentTurnNumber={openTurn?.number ?? null}
              onInspect={inspect}
              onClose={deselect}
              registerEscape={registerEscape}
              onOpenDev={onOpenDev}
              gmProfiles={gmProfiles}
            />
          ) : (
            <div className="desk-empty">
              {selected ? (
                <p className="text-sm text-muted">
                  That row isn&apos;t in the open turn&apos;s queue any more — the turn just pushed, or
                  another GM Rejected the Move. Pick another from the rail.
                </p>
              ) : (
                <p className="text-sm text-muted">
                  Pick a Move, Request or Caving roll from the queue. Everything you stage —
                  messages, effects, public declarations — goes out together when the turn ends.
                  The History lens reads back a turn that has already been pushed.
                </p>
              )}
            </div>
          )}
        </main>

        <InspectorColumn
          inspected={inspected}
          pinned={pinned}
          roster={roster}
          onInspect={inspect}
          onTogglePin={togglePin}
          cache={inspectorCache}
          setCache={setInspectorCache}
          tagsById={allTagsById}
          currentTurnNumber={openTurn?.number ?? null}
          pendingByCharacter={pendingByCharacter}
          onOpenDev={onOpenDev}
          customTag={customTag}
          requestedTab={tabRequest}
        />
      </div>

      <StagingTray
        stagedEffects={stagedEffects}
        stagedMessages={stagedMessages}
        moves={moves}
        roster={roster}
        presenceZones={presenceZones}
        factions={factions}
        tagCatalog={tagCatalog}
        onInspect={inspect}
        onOpenPreview={() => setPreviewOpen(true)}
        open={trayOpen}
        setOpen={setTrayOpen}
        expanded={trayExpanded}
        setExpanded={setTrayExpanded}
        revealSignal={revealSignal}
        gmProfiles={gmProfiles}
      />

      {previewOpen && (
        <PushPreview
          moves={moves}
          stagedEffects={stagedEffects}
          stagedMessages={stagedMessages}
          tagCatalog={tagCatalog}
          onClose={() => setPreviewOpen(false)}
          onInspect={inspect}
          onReveal={revealStagedRow}
        />
      )}

      {devPanel && (
        <DevPanelModal
          characterId={devPanel.characterId}
          name={devPanel.name}
          onClose={() => setDevPanel(null)}
        />
      )}
    </div>
    </DeskStaleRefreshGate>
  );
}
