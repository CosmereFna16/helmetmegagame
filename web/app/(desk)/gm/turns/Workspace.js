"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import QueueRail from "./QueueRail";
import MoveDesk from "./MoveDesk";
import RequestDesk from "./RequestDesk";
import InspectorColumn from "./InspectorColumn";
import StagingTray from "./StagingTray";
import PushPreview from "./PushPreview";
import DevPanelModal from "./DevPanelModal";
import { isAnyDirty } from "@/app/components/useDirtyGuard";
import { useIsCoarsePointer } from "@/app/components/useIsCoarsePointer";

// The adjudication workspace's client shell — mission control. It owns three
// pieces of state and nothing else:
//
//   selection — which Move or Request the desk shows
//   inspector — which character the right column is looking at, plus pins
//   preview   — whether the push-preview dialog is open
//
// Everything it renders is a DTO from page.js; every mutation lives in a
// child that calls a server action and router.refresh()es. The full-viewport
// .desk-* layout is this page's own (DESIGN-SYSTEM.md's sanctioned
// deviation) — tokens and shared control classes still apply.

const REFRESH_MS = 45_000;
const PINS_STORAGE_KEY = "desk-pins";

// Same pattern as web/app/(app)/map/MapPanel.js's ground preference: read
// through useSyncExternalStore so there's no setState-in-effect and no
// server/client hydration mismatch. Subscribed to the `storage` event so a
// pin change in another tab is picked up here too.
function subscribePins(callback) {
  window.addEventListener("storage", callback);
  return () => window.removeEventListener("storage", callback);
}
// getSnapshot must return the SAME reference until the value actually
// changes — a fresh array every call is an infinite render loop. So the
// parse is memoized against the raw string it came from.
const NO_PINS = [];
let pinsCache = { raw: null, value: NO_PINS };
function readStoredPins() {
  try {
    const raw = window.localStorage.getItem(PINS_STORAGE_KEY);
    if (raw === pinsCache.raw) return pinsCache.value;
    let parsed = null;
    try {
      parsed = raw ? JSON.parse(raw) : null;
    } catch {
      parsed = null;
    }
    pinsCache = { raw, value: Array.isArray(parsed) ? parsed : NO_PINS };
    return pinsCache.value;
  } catch {
    return pinsCache.value;
  }
}
function serverPins() {
  return NO_PINS;
}
function writeStoredPins(pins) {
  try {
    window.localStorage.setItem(PINS_STORAGE_KEY, JSON.stringify(pins));
  } catch {
    /* private window / blocked site data */
  }
}

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

export default function Workspace({
  openTurn,
  myZoneName,
  tagsById,
  tagCatalog,
  roster,
  zones,
  presenceZones,
  moves,
  requests,
  stagedEffects,
  stagedMessages,
  gmProfiles,
}) {
  const router = useRouter();
  const [lens, setLens] = useState("moves"); // which queue the rail shows
  const [selected, setSelected] = useState(null); // { type: "move"|"request", id }
  const [inspected, setInspected] = useState(null); // { characterId, name }
  const storedPins = useSyncExternalStore(subscribePins, readStoredPins, serverPins);
  const [localPins, setLocalPins] = useState(null); // null until the user first touches a pin this session
  const pinned = localPins ?? storedPins;
  const [previewOpen, setPreviewOpen] = useState(false);
  // { characterId, name } of the Dev Panel currently open as a modal over
  // the desk, or null. Opening it never leaves /gm/turns or resets any of
  // the state above.
  const [devPanel, setDevPanel] = useState(null);
  const onOpenDev = useCallback((characterId, name) => setDevPanel({ characterId, name }), []);

  // The push tray's open/expanded state is lifted here (rather than local to
  // StagingTray) so the interactive push preview can force it open and
  // scroll to a row (revealStagedRow below).
  const [trayOpen, setTrayOpen] = useState(false);
  const [trayExpanded, setTrayExpanded] = useState(false);
  const [revealSignal, setRevealSignal] = useState(null); // { id, token }

  const revealStagedRow = useCallback((id) => {
    setPreviewOpen(false);
    setTrayOpen(true);
    setTrayExpanded(true);
    setRevealSignal({ id, token: Date.now() });
  }, []);

  // Escape is layered, topmost-first, and this is the bottom layer:
  //   1. An open Modal (confirm, composer, unlock dialog) — Modal.js handles
  //      its own Escape; we just yield when one is on screen.
  //   2. A focused input/textarea/select — blur it, don't blow away the desk.
  //   3. A selected Move/Request — deselect through the desk's own dirty
  //      guard (registerEscape), so unsaved edits still prompt.
  //   4. Nothing selected — Escape leaves the workspace, same as ← Exit.
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
      if (active && ["INPUT", "TEXTAREA", "SELECT"].includes(active.tagName)) {
        active.blur();
        return;
      }
      if (selectedRef.current) {
        deskEscapeRef.current?.();
        return;
      }
      router.push("/gm/players");
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router, coarse]);

  // Inspector fetches are cached for the life of the page view, keyed
  // `${characterId}:${tab}`. State rather than a ref because the entries are
  // read during render (react-hooks/refs is an error here); updates replace
  // the Map immutably — see InspectorColumn.
  const [inspectorCache, setInspectorCache] = useState(() => new Map());

  const selectedMove = selected?.type === "move" ? moves.find((m) => m.id === selected.id) : null;
  const selectedRequest = selected?.type === "request" ? requests.find((r) => r.id === selected.id) : null;

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

  const solvedCount = moves.filter((m) => m.statusLabel === "Solved").length;

  function inspect(characterId, name) {
    if (!characterId) return;
    setInspected({ characterId, name });
  }

  function togglePin(character) {
    setLocalPins((prev) => {
      const base = prev ?? storedPins;
      const exists = base.some((p) => p.characterId === character.characterId);
      const next = exists
        ? base.filter((p) => p.characterId !== character.characterId)
        : [...base, character];
      writeStoredPins(next);
      return next;
    });
  }

  // Live queue refresh: paused while a modal is open (an in-flight
  // composer/dialog shouldn't be yanked from under a GM) or while any panel
  // has unsaved edits (isAnyDirty), and skipped entirely while the tab isn't
  // visible. Conditions are read at fire time, not tracked as deps, so the
  // interval never needs to be torn down and rebuilt.
  const [lastRefreshedAt, setLastRefreshedAt] = useState(null);
  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      if (document.querySelector(".modal-overlay")) return;
      if (isAnyDirty()) return;
      router.refresh();
      setLastRefreshedAt(new Date());
    }, REFRESH_MS);
    return () => clearInterval(id);
  }, [router]);

  // Countdown to the next noon/midnight CT push, ticking every 30s.
  const [pushMinutes, setPushMinutes] = useState(() => minutesUntilNextPush());
  useEffect(() => {
    const id = setInterval(() => setPushMinutes(minutesUntilNextPush()), 30_000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="desk-shell">
      <header className="desk-header">
        <div className="flex items-center gap-3">
          <h1 className="section-title">Adjudication</h1>
          <span className="chip">
            {openTurn ? `Turn ${openTurn.number} · ${openTurn.phase === "DAWN" ? "Dawn" : "Dusk"}` : "No turn open"}
          </span>
          <span className="text-xs text-muted" title="Push fires at noon & midnight CT">
            {formatCountdown(pushMinutes)}
          </span>
          <span className="chip text-xs text-muted">{solvedCount}/{moves.length} solved</span>
          {lastRefreshedAt && (
            <span className="text-xs text-muted">
              updated {lastRefreshedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button type="button" className="btn-quiet" onClick={() => setPreviewOpen(true)}>
            Preview push
          </button>
          <Link href="/gm/players" className="btn-quiet">
            ← Exit
          </Link>
        </div>
      </header>

      <div className="desk-body">
        <QueueRail
          moves={moves}
          requests={requests}
          myZoneName={myZoneName}
          stagedByMove={stagedByMove}
          selected={selected}
          onSelect={setSelected}
          lens={lens}
          onLens={setLens}
          gmProfiles={gmProfiles}
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
              zones={zones}
              presenceZones={presenceZones}
              currentTurnNumber={openTurn?.number ?? null}
              onInspect={inspect}
              onClose={() => setSelected(null)}
              registerEscape={registerEscape}
              onOpenDev={onOpenDev}
              gmProfiles={gmProfiles}
            />
          ) : selectedRequest ? (
            <RequestDesk
              key={selectedRequest.id}
              request={selectedRequest}
              onInspect={inspect}
              onClose={() => setSelected(null)}
              registerEscape={registerEscape}
              onOpenDev={onOpenDev}
            />
          ) : (
            <div className="desk-empty">
              <p className="text-sm text-muted">
                Pick a Move or Request from the queue. Everything you stage — messages, effects,
                public declarations — goes out together when the turn ends.
              </p>
            </div>
          )}
        </main>

        <InspectorColumn
          inspected={inspected}
          pinned={pinned}
          onInspect={inspect}
          onTogglePin={togglePin}
          cache={inspectorCache}
          setCache={setInspectorCache}
          tagsById={tagsById}
          currentTurnNumber={openTurn?.number ?? null}
          pendingByCharacter={pendingByCharacter}
          onOpenDev={onOpenDev}
        />
      </div>

      <StagingTray
        stagedEffects={stagedEffects}
        stagedMessages={stagedMessages}
        moves={moves}
        roster={roster}
        zones={zones}
        presenceZones={presenceZones}
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
  );
}
