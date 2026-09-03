"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import StatusPill from "@/app/components/StatusPill";
import { useIsCoarsePointer } from "@/app/components/useIsCoarsePointer";
import { describeAudit } from "@/lib/auditNarrative";
import AuditSegments from "./AuditSegments";
import { dialogHoldsKeyboard } from "@/app/components/Modal";

// The feed: one line per entry, grouped under a turn + day heading.
//
// Rows are buttons, not table rows, because selection is the verb — the same
// reasoning .desk-queue-row carries on the adjudication desk.

const PHASE = { DAWN: "Dawn", DUSK: "Dusk" };

function headingFor(entry) {
  const day = new Date(entry.createdAt).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
  const turn =
    entry.turnNumber != null
      ? `Turn ${entry.turnNumber}${entry.turnPhase ? ` · ${PHASE[entry.turnPhase] ?? entry.turnPhase}` : ""}`
      : "Before the game opened";
  return `${turn} — ${day}`;
}

// "3h", "2d". Deliberately short: the column is a glance, and the exact stamp
// is one hover (title) or one click (the inspector) away.
function relative(iso, now) {
  const seconds = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h`;
  return `${Math.round(seconds / 86400)}d`;
}

export default function AuditFeed({
  entries,
  names,
  selectedId,
  onSelect,
  absoluteTime,
  emptyMessage,
}) {
  const [kbdIndex, setKbdIndex] = useState(-1);
  const coarse = useIsCoarsePointer();
  const listRef = useRef(null);
  // One clock for the whole render rather than a Date.now() per row, so every
  // "3h" on screen agrees with every other — and in state rather than read
  // during render, which is impure and lints as an error in this repo. The
  // minute tick is also what keeps a "2m" from sitting there saying 2m.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  // Headings computed up front, alongside the sentence each row needs anyway.
  // Each row compares against its predecessor directly rather than carrying a
  // running variable — the repo lints mutation during render as an error, and
  // recomputing one heading per row is cheaper than the alternative reads.
  const rows = useMemo(
    () =>
      entries.map((entry, i) => {
        const heading = headingFor(entry);
        const first = i === 0 || heading !== headingFor(entries[i - 1]);
        return {
          entry,
          heading: first ? heading : null,
          described: describeAudit({ ...entry, names }),
        };
      }),
    [entries, names],
  );

  useEffect(() => {
    if (coarse) return undefined;
    function onKey(e) {
      const el = document.activeElement;
      // Never steal a keystroke from something being typed into, and yield to
      // any open modal — the same guard the adjudication rail uses.
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT")) return;
      if (dialogHoldsKeyboard()) return;
      if (e.key === "j" || e.key === "ArrowDown") {
        e.preventDefault();
        setKbdIndex((i) => Math.min(entries.length - 1, i + 1));
      } else if (e.key === "k" || e.key === "ArrowUp") {
        e.preventDefault();
        setKbdIndex((i) => Math.max(0, i - 1));
      } else if (e.key === "Enter" && kbdIndex >= 0 && entries[kbdIndex]) {
        e.preventDefault();
        onSelect(entries[kbdIndex].id);
      } else if (e.key === "Escape" && selectedId) {
        onSelect(null);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [coarse, entries, kbdIndex, onSelect, selectedId]);

  // Keep the cursor on screen as it walks. Scrolling the container rather than
  // focusing the row, so the keyboard handler above keeps receiving keys.
  useEffect(() => {
    if (kbdIndex < 0) return;
    listRef.current?.querySelector(`[data-index="${kbdIndex}"]`)?.scrollIntoView({ block: "nearest" });
  }, [kbdIndex]);

  if (entries.length === 0) {
    return <div className="desk-empty text-muted">{emptyMessage}</div>;
  }

  return (
    <div className="audit-feed" ref={listRef}>
      {rows.map(({ entry, heading, described }, i) => {
        const { familyLabel, tone, segments } = described;
        const stamp = new Date(entry.createdAt);
        return (
          <div key={entry.id}>
            {heading && <div className="audit-daymark">{heading}</div>}
            <button
              type="button"
              className="desk-queue-row audit-row"
              data-index={i}
              data-active={entry.id === selectedId ? "true" : "false"}
              data-kbd={i === kbdIndex ? "" : undefined}
              onClick={() => onSelect(entry.id)}
            >
              <span className="audit-row-time mono" title={stamp.toISOString()}>
                {absoluteTime ? stamp.toLocaleTimeString(undefined, { hour12: false }) : relative(entry.createdAt, now)}
              </span>
              <span className="audit-row-body">
                <AuditSegments entry={entry} segments={segments} />
                {entry.reason && <span className="audit-reason">» {entry.reason}</span>}
              </span>
              <span className="audit-row-tail">
                {tone !== "neutral" && <StatusPill tone={tone}>{familyLabel}</StatusPill>}
                {tone === "neutral" && <span className="text-muted text-xs">{familyLabel}</span>}
              </span>
            </button>
          </div>
        );
      })}
    </div>
  );
}
