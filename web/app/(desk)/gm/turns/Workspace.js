"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRefresh } from "@/app/components/useRefresh";
import QueueRail from "./QueueRail";
import MoveDesk from "./MoveDesk";
import RequestDesk from "./RequestDesk";
import CavingDesk from "./CavingDesk";
import InspectorColumn from "@/app/components/InspectorColumn";
import StagingTray from "./StagingTray";
import PushPreview from "./PushPreview";
import DevPanelModal from "@/app/components/DevPanelModal";
import DeskHeader from "@/app/components/DeskHeader";
import { isAnyDirty } from "@/app/components/useDirtyGuard";
import usePins from "@/app/components/usePins";
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

export default function Workspace({
  initialSelection,
  openTurn,
  myZoneNames,
  tagsById,
  tagCatalog,
  roster,
  presenceZones,
  moves,
  requests,
  cavingRolls,
  stagedEffects,
  stagedMessages,
  gmProfiles,
  moveLock,
}) {
  const [refresh] = useRefresh();
  const [lens, setLens] = useState("moves"); // which queue the rail shows
  const [selected, setSelected] = useState(initialSelection ?? null); // { type: "move"|"request"|"caving", id }

  // The URL mirrors `selected`; it is never its source after the first paint.
  // replaceState is Next's documented escape hatch: it syncs the router
  // without fetching an RSC payload, so picking a row leaves the queue, every
  // DTO, the inspector cache and the tray exactly as they were. A router.push
  // here would reload the whole desk on every click.
  //
  // replaceState, not pushState, so Back leaves the desk rather than walking
  // your selection history — and so nothing has to listen for popstate.
  const select = useCallback((sel) => {
    setSelected(sel);
    window.history.replaceState(null, "", selectionHref(sel));
  }, []);
  const deselect = useCallback(() => select(null), [select]);
  const [inspected, setInspected] = useState(null); // { characterId, name }
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
  // With nothing selected, Escape does nothing. It used to navigate to
  // /gm/players, which made the desk feel like a mode you were trapped in
  // rather than a page: one stray keystroke and the whole workspace was gone.
  // The nav rail is how you leave.
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

  const selectedMove = selected?.type === "move" ? moves.find((m) => m.id === selected.id) : null;
  const selectedRequest = selected?.type === "request" ? requests.find((r) => r.id === selected.id) : null;
  const selectedCaving =
    selected?.type === "caving" ? (cavingRolls ?? []).find((c) => c.id === selected.id) : null;

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

  const solvedCount = moves.filter((m) => m.statusLabel === "Solved").length;

  // The inspector's custom-tag door. It defaults to STAGING here: this desk
  // is mid-push, so a tag invented while chasing a Move belongs in the tray
  // with everything else rather than landing live. Same catalog the effect
  // composer's door uses; TAG_CHIP_FIELDS doesn't carry a group id, so the
  // dialog drops its Group picker rather than offering one it can't resolve.
  const customTag = useMemo(
    () => ({
      mode: "stage",
      categories: [...new Set(tagCatalog.map((t) => t.category))].sort((a, b) => a.localeCompare(b)),
      tags: tagCatalog,
    }),
    [tagCatalog],
  );

  function inspect(characterId, name) {
    if (!characterId) return;
    setInspected({ characterId, name });
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
      refresh();
      setLastRefreshedAt(new Date());
    }, REFRESH_MS);
    return () => clearInterval(id);
  }, [refresh]);

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
          </>
        }
        actions={
          <button type="button" className="btn-quiet" onClick={() => setPreviewOpen(true)}>
            Preview push
          </button>
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
          tagsById={tagsById}
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
          ) : selectedCaving ? (
            <CavingDesk
              key={selectedCaving.id}
              roll={selectedCaving}
              staged={stagedByCaving.get(selectedCaving.id) ?? { effects: [], messages: [] }}
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
              <p className="text-sm text-muted">
                Pick a Move, Request or Caving roll from the queue. Everything you stage —
                messages, effects, public declarations — goes out together when the turn ends.
              </p>
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
          tagsById={tagsById}
          currentTurnNumber={openTurn?.number ?? null}
          pendingByCharacter={pendingByCharacter}
          onOpenDev={onOpenDev}
          customTag={customTag}
        />
      </div>

      <StagingTray
        stagedEffects={stagedEffects}
        stagedMessages={stagedMessages}
        moves={moves}
        roster={roster}
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
