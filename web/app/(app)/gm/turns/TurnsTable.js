"use client";

import { useMemo, useState } from "react";
import Link from "next/link";

export default function TurnsTable({ actions }) {
  const [zoneFilter, setZoneFilter] = useState("");
  const [factionFilter, setFactionFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");

  const zones = useMemo(() => [...new Set(actions.map((a) => a.zoneName).filter(Boolean))].sort(), [actions]);
  const factions = useMemo(
    () => [...new Set(actions.map((a) => a.factionName).filter(Boolean))].sort(),
    [actions],
  );

  const filtered = actions.filter(
    (a) =>
      (!zoneFilter || a.zoneName === zoneFilter) &&
      (!factionFilter || a.factionName === factionFilter) &&
      (!typeFilter || a.type === typeFilter) &&
      (!statusFilter || a.status === statusFilter),
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
        <label className="field">
          <span className="field-label">Status</span>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">All</option>
            <option value="PENDING">Pending</option>
            <option value="CONFIRMED">Confirmed</option>
            <option value="ADJUDICATED">Adjudicated</option>
          </select>
        </label>
      </div>

      <div className="panel overflow-x-auto">
        <table className="data-table">
          <thead>
            <tr>
              <th>Turn</th>
              <th>Character</th>
              <th>Faction</th>
              <th>Zone</th>
              <th>Type</th>
              <th>Dice</th>
              <th>Status</th>
              <th>Description</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((a) => (
              <tr key={a.id}>
                <td>{a.turnNumber}</td>
                <td>
                  <Link href={`/gm/turns/${a.id}`} className="menu-item">
                    {a.characterName}
                  </Link>
                </td>
                <td>{a.factionName || "-"}</td>
                <td>{a.zoneName || "-"}</td>
                <td>{a.type === "MOVE" ? "Move" : "Effort"}</td>
                <td>{a.diceRoll ?? "-"}</td>
                <td>{a.status}</td>
                <td className="max-w-xs truncate">{a.description}</td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={8} className="text-center" style={{ color: "var(--muted)" }}>
                  No actions match these filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
