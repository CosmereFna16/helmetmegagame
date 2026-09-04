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
import { dialogHoldsKeyboard } from "@/app/components/Modal";

// The adjudication workspace's client shell. Owns selection (which
// Move/Request shows), inspector (right column + pins), and preview (push
// dialog). Everything rendered is a DTO from page.js; mutations live in a
// child that calls a server action and router.refresh()es.

const REFRESH_MS = 45_000;

// Click-frequency view state, split from QueueRail's RAIL_STORAGE_KEY so the
// two subscriber sets stay independent.
const DESK_STORAGE_KEY = "gm-turns-desk";
const DESK_STORAGE_DEFAULT = {
  trayOpen: false,
  trayExpanded: false,
  inspected: null, // { characterId, name }
  historyTurnId: null,
};

// The countdown used to re-derive the cron's boundary hours here, in the
// browser, off the wall clock — a second copy of the rule that lived in
// db/lib/turnClock.js, and one that went stale the moment the turn stopped
// being half a day. The open turn now arrives carrying `endsAtMs`, derived
// server-side by the same moveWindow() the Move cutoff uses, so there is one
// authority again.
function formatCountdown(minutes) {
  if (minutes == null) return "";
  if (minutes <= 0) return "Push imminent";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h <= 0) return `Push in ${m}m`;
  return `Push in ${h}h ${m}m`;
}

// The last stretch of a turn, when players can no longer send a Move
// (TURN-ENGINE.md, db/lib/turnClock.js#moveWindow). Absent when auto-advance
// is off or the turn is too short to carry a cutoff.
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

// A selected history row can belong to a turn other than the one the picker
// is on, so this looks across every loaded turn, falling back to the deep
// link's preloaded row.
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

// The Caving twin of findHistoryMove.
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

// The history entry's staged rows keyed by Move. A plain function, not a
// useMemo, because its input is a cache the render itself can evict.
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
      `e:${e.id}:${e.resources}:${e.tagPoints}:${e.locationId ?? ""}:${JSON.stringify(e.tagOps ?? [])}`,
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
  stagingLocations,
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
  const [desk, setDesk] = useSessionState(DESK_STORAGE_KEY, DESK_STORAGE_DEFAULT);
  const [rail, setRail] = useSessionState(RAIL_STORAGE_KEY, RAIL_STORAGE_DEFAULT);
  // A deep link's lens/turn is a one-shot correction over persisted state,
  // set at render time, never in an effect (react-hooks/set-state-in-effect
  // is an error here).
  const [seenDeepLinkId, setSeenDeepLinkId] = useState(null);
  if (
    typeof window !== "undefined" &&
    initialSelection?.type === "history" &&
    seenDeepLinkId !== initialSelection.id
  ) {
    setSeenDeepLinkId(initialSelection.id);
    if (rail.lens !== "history") setRail((r) => ({ ...r, lens: "history" }));
    if (initialHistory?.turnId && desk.historyTurnId !== initialHistory.turnId) {
      setDesk((d) => ({ ...d, historyTurnId: initialHistory.turnId }));
    }
  }
  // The Caving twin of the deep link above. page.js sets initialCaving only
  // for a roll on a resolved turn, so its presence signals swinging History
  // onto Caving and that roll's turn.
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

  // The URL mirrors `selected` via replaceState (not pushState, so Back
  // leaves the desk), avoiding an RSC refetch a router.push would trigger.
  const confirm = useConfirm();
  // A fresh `select` goes through the same dirty guard as Close/Escape —
  // isAnyDirty() (useDirtyGuard.js).
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
  // Who the inspector column looks at, persisted so a deploy-forced reload
  // doesn't blank it. Not validated against the roster (ALIVE-only) —
  // inspecting the dead is a feature.
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
  // One pin list shared with the player desk (usePins.js) — this desk only
  // knows characters, so it prunes the "c:" namespace against the roster.
  const knownPinIdentities = useMemo(() => new Set(roster.map((c) => `c:${c.id}`)), [roster]);
  const { pins: pinned, togglePin } = usePins({ knownIdentities: knownPinIdentities });
  const [previewOpen, setPreviewOpen] = useState(false);
  const [devPanel, setDevPanel] = useState(null); // { characterId, name } or null
  const onOpenDev = useCallback((characterId, name) => setDevPanel({ characterId, name }), []);

  // Lifted here (not local to StagingTray) so the push preview can force the
  // tray open and scroll to a row (revealStagedRow below).
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

  // Escape is layered, topmost-first: an open Modal handles its own; a
  // focused field just blurs; a selected Move/Request deselects through the
  // dirty guard. Nothing selected -> Escape does nothing.
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
    // No Escape wiring on a touch-primary device.
    if (coarse) return undefined;
    function onKey(e) {
      if (e.key !== "Escape") return;
      if (dialogHoldsKeyboard()) return;
      const active = document.activeElement;
      // A Select's own Escape (Select.js) already stopPropagation()s, so
      // reaching here with one focused means no popup was open.
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

  // Inspector fetches, cached for the life of the page view, keyed
  // `${characterId}:${tab}`. State, not a ref, because entries are read
  // during render (react-hooks/refs is an error here).
  const [inspectorCache, setInspectorCache] = useState(() => new Map());

  // The History lens's rows, one resolved turn per entry, fetched on demand.
  // State because it's read during render; setCache lands after the await,
  // never synchronously in the effect body (react-hooks/set-state-in-effect).
  const [historyByTurn, setHistoryByTurn] = useState(() => new Map());
  // Open turn first, then every resolved turn newest-first.
  const historyTurnOptions = useMemo(() => {
    const opts = openTurn ? [{ id: openTurn.id, label: `${openTurn.label} · open` }] : [];
    for (const t of resolvedTurns ?? []) opts.push({ id: t.id, label: t.label });
    return opts;
  }, [openTurn, resolvedTurns]);
  const storedHistoryTurnId = desk.historyTurnId ?? null;
  // Validated against the option list, open turn included, or a GM parked
  // there loses the selection on every reload.
  const historyTurnId =
    storedHistoryTurnId && historyTurnOptions.some((t) => t.id === storedHistoryTurnId)
      ? storedHistoryTurnId
      : (initialHistory?.turnId ?? resolvedTurns?.[0]?.id ?? null);
  // On the open turn the lens reads the live props this page already ships
  // instead of the history cache, so there's no second copy to drift.
  const historyIsOpenTurn = Boolean(openTurn && historyTurnId === openTurn.id);
  const setHistoryTurnId = useCallback(
    (turnId) => setDesk((d) => ({ ...d, historyTurnId: turnId })),
    [setDesk],
  );
  const [historyError, setHistoryError] = useState(null);

  // Invalidates the cache when a past-turn staged row is edited or deleted:
  // router.refresh() re-runs page.js but never getMoveHistory. Taken during
  // render, not from an effect.
  const stagedFingerprint = useMemo(
    () => fingerprintUnapplied(stagedEffects, stagedMessages),
    [stagedEffects, stagedMessages],
  );
  // Marked stale rather than dropped, so the desk doesn't blink through an
  // empty state while the refetch is in flight.
  const [lastStagedFingerprint, setLastStagedFingerprint] = useState(stagedFingerprint);
  let historyCache = historyByTurn;
  if (stagedFingerprint !== lastStagedFingerprint) {
    historyCache = new Map();
    for (const [id, entry] of historyByTurn) historyCache.set(id, { ...entry, stale: true });
    setLastStagedFingerprint(stagedFingerprint);
    setHistoryByTurn(historyCache);
  }

  // The open turn's rows are the live ones page.js shipped; every other turn
  // comes out of the cache.
  const historyEntry = historyIsOpenTurn
    ? { moves, cavingRolls, effects: stagedEffects, messages: stagedMessages, tagsById }
    : historyTurnId
      ? (historyCache.get(historyTurnId) ?? null)
      : null;
  const historyLoading =
    !historyIsOpenTurn && lens === "history" && Boolean(historyTurnId) && !historyEntry && !historyError;

  useEffect(() => {
    // getMoveHistory guards on RESOLVED (actions.js); never asked here since
    // the live props are already present.
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
      // guarded() only converts a UserError into a result; anything else
      // rejects, and without this catch the rail hangs on "Loading…".
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

  const historyStagedByMove = groupByMove(historyEntry);

  const selectedHistory =
    selected?.type === "history" ? findHistoryMove(historyCache, selected.id, initialHistory) : null;

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
  // Resolves against live open-turn rolls first; otherwise a History-lens
  // pick found across every loaded turn.
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

  // Net staged resources/tag points and pending tag ops per character, over
  // everything not yet applied by a push.
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

  // Same shape as stagedByMove, keyed by cavingRollId (CavingDesk.js).
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

  // Defaults to STAGING: a tag invented while chasing a Move belongs in the
  // tray, not live.
  const customTag = useMemo(
    () => ({
      mode: "stage",
      categories: [...new Set(tagCatalog.map((t) => t.category))].sort((a, b) => a.localeCompare(b)),
      tags: tagCatalog,
    }),
    [tagCatalog],
  );

  // The optional third arg is a tab REQUEST, not a controlled value; the
  // token tells InspectorColumn this is a new ask.
  function inspect(characterId, name, tab) {
    if (!characterId) return;
    setInspected({ characterId, name });
    if (tab) setTabRequest((prev) => ({ tab, token: (prev?.token ?? 0) + 1 }));
  }

  // Shared gated poll (useGatedRefreshPoll.js). deployVersion is the
  // anti-yank guard: a router.refresh() against a stale build trips Next's
  // full-navigation mismatch fallback, so a deploy latches the reload chip
  // below instead.
  const lastRefreshedAt = useGatedRefreshPoll(REFRESH_MS, deployVersion);

  useReloadTelemetry("turns", deployVersion);

  // Countdown to the nightly CT push, ticking every 30s. The move cutoff rides
  // the same tick.
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);
  const pushMinutes = openTurn?.endsAtMs != null ? Math.round((openTurn.endsAtMs - nowMs) / 60_000) : null;

  return (
    // Once a deploy latches `stale`, refreshes under this gate skip instead
    // of hard-reloading across the build boundary.
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
            <span className="text-xs text-muted" title="Push fires at midnight CT">
              {formatCountdown(pushMinutes)}
              {moveLock ? ` · ${formatMoveLock(moveLock.cutoffAtMs, nowMs)}` : ""}
            </span>
            {lastRefreshedAt && (
              <span className="text-xs text-muted">
                updated {lastRefreshedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              </span>
            )}
            {/* isAnyDirty() is a plain module counter, read at render time. */}
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
              stagingLocations={stagingLocations}
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
              stagingLocations={stagingLocations}
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
              stagingLocations={stagingLocations}
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
        stagingLocations={stagingLocations}
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
