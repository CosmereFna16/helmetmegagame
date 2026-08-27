"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import QueueRail from "./QueueRail";
import MoveDesk from "./MoveDesk";
import RequestDesk from "./RequestDesk";
import InspectorColumn from "./InspectorColumn";
import StagingTray from "./StagingTray";
import PushPreview from "./PushPreview";

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
export default function Workspace({
  openTurn,
  myZoneName,
  tagsById,
  tagCatalog,
  roster,
  zones,
  moves,
  requests,
  stagedEffects,
  stagedMessages,
}) {
  const [lens, setLens] = useState("moves"); // which queue the rail shows
  const [selected, setSelected] = useState(null); // { type: "move"|"request", id }
  const [inspected, setInspected] = useState(null); // { characterId, name }
  const [pinned, setPinned] = useState([]); // [{ characterId, name }]
  const [previewOpen, setPreviewOpen] = useState(false);

  // Inspector fetches are cached for the life of the page view, keyed
  // `${characterId}:${tab}`. State rather than a ref because the entries are
  // read during render (react-hooks/refs is an error here); updates replace
  // the Map immutably — see InspectorColumn.
  const [inspectorCache, setInspectorCache] = useState(() => new Map());

  const selectedMove = selected?.type === "move" ? moves.find((m) => m.id === selected.id) : null;
  const selectedRequest = selected?.type === "request" ? requests.find((r) => r.id === selected.id) : null;

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

  function inspect(characterId, name) {
    if (!characterId) return;
    setInspected({ characterId, name });
  }

  function togglePin(character) {
    setPinned((prev) => {
      const exists = prev.some((p) => p.characterId === character.characterId);
      if (exists) return prev.filter((p) => p.characterId !== character.characterId);
      return [...prev, character];
    });
  }

  return (
    <div className="desk-shell">
      <header className="desk-header">
        <div className="flex items-center gap-3">
          <h1 className="section-title">Adjudication</h1>
          <span className="chip">
            {openTurn ? `Turn ${openTurn.number} · ${openTurn.phase === "DAWN" ? "Dawn" : "Dusk"}` : "No turn open"}
          </span>
          <span className="text-xs text-muted">Push fires at noon &amp; midnight CT</span>
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
              currentTurnNumber={openTurn?.number ?? null}
              onInspect={inspect}
              onClose={() => setSelected(null)}
            />
          ) : selectedRequest ? (
            <RequestDesk
              key={selectedRequest.id}
              request={selectedRequest}
              onInspect={inspect}
              onClose={() => setSelected(null)}
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
        />
      </div>

      <StagingTray
        stagedEffects={stagedEffects}
        stagedMessages={stagedMessages}
        moves={moves}
        roster={roster}
        zones={zones}
        tagCatalog={tagCatalog}
        onInspect={inspect}
        onOpenPreview={() => setPreviewOpen(true)}
      />

      {previewOpen && (
        <PushPreview
          moves={moves}
          stagedEffects={stagedEffects}
          stagedMessages={stagedMessages}
          tagCatalog={tagCatalog}
          onClose={() => setPreviewOpen(false)}
        />
      )}
    </div>
  );
}
