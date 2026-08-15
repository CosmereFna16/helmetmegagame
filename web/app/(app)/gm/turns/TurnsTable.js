"use client";

import { Fragment, useMemo, useState } from "react";
import Link from "next/link";
import { ScaleIcon, MessageIcon } from "../../../components/icons";
import { formatTurnLabel } from "@/lib/turn";
import { sendGmMessage } from "../actions";

export default function TurnsTable({ actions, onShowAdjudication }) {
  const [zoneFilter, setZoneFilter] = useState("");
  const [factionFilter, setFactionFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [messageRowId, setMessageRowId] = useState(null);

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
            <option value="ADJUDICATED">Complete</option>
          </select>
        </label>
      </div>

      <div className="panel overflow-x-auto">
        <table className="data-table" style={{ minWidth: "1100px" }}>
          <thead>
            <tr>
              <th></th>
              <th></th>
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
              <Fragment key={a.id}>
                <tr>
                  <td>
                    <button
                      type="button"
                      className="btn-quiet"
                      aria-label={`Message ${a.characterName}`}
                      onClick={() => setMessageRowId((cur) => (cur === a.id ? null : a.id))}
                    >
                      <MessageIcon width={16} height={16} />
                    </button>
                  </td>
                  <td>
                    <Link href={`/gm/turns/${a.id}`} className="btn-quiet" aria-label={`Adjudicate ${a.characterName}`}>
                      <ScaleIcon width={16} height={16} />
                    </Link>
                  </td>
                  <td>{formatTurnLabel(a.turnNumber, a.turnPhase)}</td>
                  <td>{a.characterName}</td>
                  <td>{a.factionName || "-"}</td>
                  <td>{a.zoneName || "-"}</td>
                  <td>{a.type === "MOVE" ? "Move" : "Effort"}</td>
                  <td>{a.diceRoll ?? "-"}</td>
                  <td>
                    {a.status === "ADJUDICATED" ? (
                      <button type="button" className="status-link" onClick={() => onShowAdjudication(a.id)}>
                        Complete
                      </button>
                    ) : a.status === "PENDING" ? (
                      "Pending"
                    ) : (
                      "Confirmed"
                    )}
                  </td>
                  <td className="max-w-xs truncate">{a.description}</td>
                </tr>
                {messageRowId === a.id && (
                  <tr key={`${a.id}-message`}>
                    <td colSpan={10}>
                      <form
                        action={sendGmMessage}
                        className="flex items-end gap-2 py-2"
                        onSubmit={() => setMessageRowId(null)}
                      >
                        <input type="hidden" name="characterId" value={a.characterId} />
                        <label className="field" style={{ flex: 1 }}>
                          <span className="field-label">Message {a.characterName} (from Lifeweb)</span>
                          <textarea name="message" rows={2} required />
                        </label>
                        <button type="submit" className="btn">
                          Send
                        </button>
                      </form>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={10} className="text-center" style={{ color: "var(--muted)" }}>
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
