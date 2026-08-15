"use client";

import { useEffect, useRef } from "react";
import { formatTurnLabel } from "@/lib/turn";

export default function AdjudicationsTable({ entries, highlightId }) {
  const highlightRef = useRef(null);

  useEffect(() => {
    if (highlightId && highlightRef.current) {
      highlightRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [highlightId]);

  return (
    <div className="panel overflow-x-auto">
      <table className="data-table" style={{ minWidth: "1100px" }}>
        <thead>
          <tr>
            <th>Turn</th>
            <th>Player</th>
            <th>Dice</th>
            <th style={{ minWidth: "320px" }}>Adjudication message</th>
            <th style={{ minWidth: "320px" }}>GM notes (private)</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((e) => (
            <tr
              key={e.id}
              ref={e.id === highlightId ? highlightRef : null}
              style={e.id === highlightId ? { background: "color-mix(in srgb, var(--accent) 15%, transparent)" } : undefined}
            >
              <td>{formatTurnLabel(e.turnNumber, e.turnPhase)}</td>
              <td>{e.characterName}</td>
              <td>{e.diceRoll ?? "-"}</td>
              <td>{e.resultMessage || "-"}</td>
              <td style={{ color: "var(--muted)" }}>{e.gmNotes || "-"}</td>
            </tr>
          ))}
          {entries.length === 0 && (
            <tr>
              <td colSpan={5} className="text-center" style={{ color: "var(--muted)" }}>
                No adjudications yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
