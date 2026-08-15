"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { formatTurnLabel } from "@/lib/turn";

export default function AdjudicationsTable({ entries, highlightId }) {
  const highlightRef = useRef(null);
  const [zoneFilter, setZoneFilter] = useState("");
  const [factionFilter, setFactionFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");

  useEffect(() => {
    if (highlightId && highlightRef.current) {
      highlightRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [highlightId]);

  const zones = useMemo(() => [...new Set(entries.map((e) => e.zoneName).filter(Boolean))].sort(), [entries]);
  const factions = useMemo(() => [...new Set(entries.map((e) => e.factionName).filter(Boolean))].sort(), [entries]);

  const filtered = entries.filter(
    (e) =>
      (!zoneFilter || e.zoneName === zoneFilter) &&
      (!factionFilter || e.factionName === factionFilter) &&
      (!typeFilter || e.type === typeFilter),
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <label className="field">
          <span className="field-label">Zone</span>
          <select value={zoneFilter} onChange={(e) => setZoneFilter(e.target.value)}>
            <option value="">All</option>
            {zones.map((z) => (
              <option key={z} value={z}>
                {z}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field-label">Faction</span>
          <select value={factionFilter} onChange={(e) => setFactionFilter(e.target.value)}>
            <option value="">All</option>
            {factions.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field-label">Type</span>
          <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
            <option value="">All</option>
            <option value="EFFORT">Effort</option>
            <option value="MOVE">Move</option>
          </select>
        </label>
      </div>

      <div className="panel overflow-x-auto">
        <table className="data-table" style={{ minWidth: "1100px" }}>
          <thead>
            <tr>
              <th>Turn</th>
              <th>Player</th>
              <th>Faction</th>
              <th>Zone</th>
              <th>Type</th>
              <th>Dice</th>
              <th style={{ minWidth: "320px" }}>Adjudication message</th>
              <th style={{ minWidth: "320px" }}>GM notes (private)</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((e) => (
              <tr
                key={e.id}
                ref={e.id === highlightId ? highlightRef : null}
                style={
                  e.id === highlightId
                    ? { background: "color-mix(in srgb, var(--accent) 15%, transparent)" }
                    : undefined
                }
              >
                <td>{formatTurnLabel(e.turnNumber, e.turnPhase)}</td>
                <td>{e.characterName}</td>
                <td>{e.factionName || "-"}</td>
                <td>{e.zoneName || "-"}</td>
                <td>{e.type === "MOVE" ? "Move" : "Effort"}</td>
                <td>{e.diceRoll ?? "-"}</td>
                <td>{e.resultMessage || "-"}</td>
                <td style={{ color: "var(--muted)" }}>{e.gmNotes || "-"}</td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={8} className="text-center" style={{ color: "var(--muted)" }}>
                  No completed actions match these filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
