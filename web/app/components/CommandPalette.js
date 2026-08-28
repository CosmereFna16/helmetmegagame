"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Modal from "./Modal";
import { scoreMatch } from "@/lib/fuzzySearch";
import { getPaletteIndex } from "./paletteActions";

// ⌘K: one box that reaches everything. Type a name and land on that player's
// desk, type a fragment of a move and land on it already selected in
// Adjudication, type a zone or a faction or the name of a screen.
//
// It exists because the rail is 56px of icons and several GM screens
// (/gm/gamemasters, /gm/dev/tags, /gm/dev/factions, /gm/audit) have no rail
// item at all — they were reachable only by knowing the URL or by hunting a
// hand-rolled sub-nav on some other page.
//
// Built on Modal so it inherits the focus trap, the focus restore and the
// module-level topmost-modal stack that makes Escape close exactly one thing.
// Carrying .modal-overlay also means the adjudication desk's own Escape
// handler and its 45s refresh both stand down while the palette is open,
// which they already do for every other dialog.

const INDEX_TTL_MS = 60_000;

const KIND_LABELS = {
  player: "Player",
  move: "Move",
  request: "Request",
  zone: "Zone",
  faction: "Faction",
  page: "Page",
};

// Beyond this the list stops being scannable and starts being a database
// dump. Ranked, so the tail is what you least meant.
const MAX_RESULTS = 20;

export default function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const [entries, setEntries] = useState(null);
  const fetchedAtRef = useRef(0);

  useEffect(() => {
    function onKey(e) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Fetched on open, then held for a minute. setEntries lands after the await,
  // never synchronously in the effect body.
  useEffect(() => {
    if (!open) return undefined;
    if (entries && Date.now() - fetchedAtRef.current < INDEX_TTL_MS) return undefined;
    let cancelled = false;
    (async () => {
      const res = await getPaletteIndex();
      if (cancelled) return;
      fetchedAtRef.current = Date.now();
      setEntries(res?.ok ? res.entries : []);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, entries]);

  const results = useMemo(() => {
    const list = entries ?? [];
    const q = query.trim();
    if (!q) {
      // Pages first with an empty box: with nothing typed the useful answer is
      // "where can I go", not the first twenty characters alphabetically.
      return list.filter((e) => e.kind === "page").slice(0, MAX_RESULTS);
    }
    return list
      .map((e) => ({
        entry: e,
        match: scoreMatch(q, { name: e.label, ...(e.search ?? {}) }),
      }))
      .filter((r) => r.match)
      .sort((a, b) => b.match.score - a.match.score)
      .slice(0, MAX_RESULTS)
      .map((r) => r.entry);
  }, [entries, query]);

  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
    setCursor(0);
  }, []);

  const go = useCallback(
    (entry) => {
      if (!entry) return;
      close();
      router.push(entry.href);
    },
    [close, router],
  );

  // Cursor is clamped at read time rather than reset in an effect —
  // react-hooks/set-state-in-effect is an error in this repo, and a filtered
  // list shrinking under a stale index is exactly the case it catches.
  const active = results.length ? Math.min(cursor, results.length - 1) : 0;

  function onInputKeyDown(e) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setCursor(Math.min(active + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setCursor(Math.max(active - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      go(results[active]);
    }
  }

  if (!open) return null;

  return (
    <Modal open onClose={close} width="default" panelClassName="palette-panel" labelledBy="palette-input">
      <label className="field">
        <span className="sr-only" id="palette-input">
          Jump to
        </span>
        <input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setCursor(0);
          }}
          onKeyDown={onInputKeyDown}
          placeholder="Jump to a player, a move, a zone, a page…"
        />
      </label>

      <div className="palette-results">
        {entries === null && <p className="text-sm text-muted p-3">Loading…</p>}
        {entries !== null && results.length === 0 && (
          <p className="text-sm text-muted p-3">Nothing matches.</p>
        )}
        {results.map((e, i) => (
          <button
            key={`${e.kind}:${e.id}`}
            type="button"
            className="palette-row"
            data-active={i === active ? "true" : "false"}
            data-dim={e.dim ? "true" : undefined}
            onMouseEnter={() => setCursor(i)}
            onClick={() => go(e)}
          >
            <span className="palette-row-kind mono">{KIND_LABELS[e.kind] ?? e.kind}</span>
            <span className="palette-row-label">{e.label}</span>
            {e.hint && <span className="palette-row-hint">{e.hint}</span>}
          </button>
        ))}
      </div>

      <p className="text-xs text-muted px-3 pb-2">↑↓ to move · ⏎ to open · esc to close</p>
    </Modal>
  );
}
