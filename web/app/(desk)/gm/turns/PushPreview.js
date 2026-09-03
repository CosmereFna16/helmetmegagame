"use client";

import { useMemo } from "react";
import Modal from "@/app/components/Modal";
import { chunkCount, effectSummary, tagNameLookup, truncate } from "./stagedFormat";

// What the push will actually do, grouped by recipient character — every DM
// they'll get, the net staged deltas, their own Move's declared numbers —
// plus the public declarations. Pure client derivation over data the page
// already holds; nothing here fetches.
export default function PushPreview({ moves, stagedEffects, stagedMessages, tagCatalog, onClose, onInspect, onReveal }) {
  const tagNames = useMemo(() => tagNameLookup(tagCatalog), [tagCatalog]);

  const perCharacter = useMemo(() => {
    const map = new Map();
    const entry = (id, name) => {
      const found = map.get(id) ?? { name, declared: null, effects: [], messages: [] };
      map.set(id, found);
      return found;
    };

    for (const m of moves) {
      if (m.resourceDelta) {
        entry(m.characterId, m.characterName).declared = m.resourceDelta;
      }
    }
    for (const e of stagedEffects) {
      if (e.applied) continue;
      // A Silo -> Silo transfer has no character to group under — give each
      // one its own bucket (keyed by its own row id) rather than piling every
      // such row into one shared "no character" entry.
      const id = e.targetCharacterId ?? `silo:${e.id}`;
      const name = e.targetCharacterId ? e.targetName : "Silo transfer";
      entry(id, name).effects.push({ id: e.id, text: effectSummary(e, tagNames) });
    }
    for (const msg of stagedMessages) {
      if (msg.sent || msg.kind !== "PRIVATE") continue;
      for (const r of msg.recipients) {
        entry(r.characterId, r.name).messages.push({
          id: msg.id,
          text: truncate(msg.content, 80),
          chunks: chunkCount(msg.content),
        });
      }
    }
    return [...map.entries()]
      .map(([id, v]) => ({ id, ...v }))
      .filter((v) => v.declared || v.effects.length || v.messages.length)
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [moves, stagedEffects, stagedMessages, tagNames]);

  const publicPosts = stagedMessages.filter((m) => m.kind === "PUBLIC" && !m.sent);

  return (
    <Modal modeless title="Push preview" width="wide" onClose={onClose}>
      <p className="mt-2 text-xs text-muted">
        What goes out when the turn ends — declared payouts, staged effects, and every DM, per
        character. Open Moves not listed here close silently on their declared numbers.
      </p>

      <div className="mt-4 flex flex-col gap-4" style={{ maxHeight: "60vh", overflowY: "auto" }}>
        {perCharacter.map((c) => (
          <div key={c.id} className="panel p-3">
            <p className="text-sm font-medium">
              {c.id.startsWith("silo:") ? (
                c.name
              ) : (
                <button type="button" className="desk-name" onClick={() => onInspect?.(c.id, c.name)}>
                  {c.name}
                </button>
              )}
            </p>
            <ul className="mt-1 flex flex-col gap-1 text-sm">
              {c.declared ? (
                <li className="mono">
                  declared: {c.declared > 0 ? "+" : ""}
                  {c.declared} ⬢
                </li>
              ) : null}
              {c.effects.map((e) => (
                <li key={e.id}>
                  <button type="button" className="desk-preview-line mono" onClick={() => onReveal?.(e.id)}>
                    staged: {e.text}
                  </button>
                </li>
              ))}
              {c.messages.map((m, i) => (
                <li key={`${m.id}-${i}`}>
                  <button type="button" className="desk-preview-line text-muted" onClick={() => onReveal?.(m.id)}>
                    ✉ » {m.text}
                    {m.chunks > 1 && <span className="chip ml-1">{m.chunks} msgs</span>}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
        {perCharacter.length === 0 && <p className="text-sm text-muted">Nothing staged for anyone yet.</p>}

        {publicPosts.length > 0 && (
          <div className="panel p-3">
            <p className="text-sm font-medium">Public declarations</p>
            <ul className="mt-1 flex flex-col gap-1 text-sm">
              {publicPosts.map((p) => (
                <li key={p.id}>
                  <button type="button" className="desk-preview-line" onClick={() => onReveal?.(p.id)}>
                    {p.zoneName ? <span className="chip">{p.zoneName}</span> : null} {truncate(p.content, 120)}
                    {chunkCount(p.content) > 1 && <span className="chip ml-1">{chunkCount(p.content)} msgs</span>}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <div className="modal-actions">
        <button type="button" className="btn" onClick={onClose}>
          Close
        </button>
      </div>
    </Modal>
  );
}
