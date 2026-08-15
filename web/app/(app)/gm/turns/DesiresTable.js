"use client";

import { Fragment, useMemo, useState } from "react";
import { formatTurnLabel } from "@/lib/turn";
import { DESIRE_MIN_POINTS, DESIRE_MAX_POINTS } from "@/lib/desire";
import { adjudicateDesire } from "../actions";

const STATUS_LABELS = {
  ACTIVE: "Active",
  PENDING: "Pending review",
  COMPLETED: "Approved",
  ABANDONED: "Cancelled",
};

export default function DesiresTable({ desires }) {
  const [factionFilter, setFactionFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [openRowId, setOpenRowId] = useState(null);

  const factions = useMemo(() => [...new Set(desires.map((d) => d.factionName).filter(Boolean))].sort(), [desires]);

  const filtered = desires.filter(
    (d) => (!factionFilter || d.factionName === factionFilter) && (!statusFilter || d.status === statusFilter),
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3">
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
          <span className="field-label">Status</span>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">All</option>
            <option value="ACTIVE">Active</option>
            <option value="PENDING">Pending review</option>
            <option value="COMPLETED">Approved</option>
            <option value="ABANDONED">Cancelled</option>
          </select>
        </label>
      </div>

      <div className="panel overflow-x-auto">
        <table className="data-table" style={{ minWidth: "1000px" }}>
          <thead>
            <tr>
              <th></th>
              <th>Turn</th>
              <th>Character</th>
              <th>Faction</th>
              <th>Desire</th>
              <th>Status</th>
              <th>Points</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((d) => (
              <Fragment key={d.id}>
                <tr>
                  <td>
                    {d.status === "PENDING" && (
                      <button
                        type="button"
                        className="status-link"
                        onClick={() => setOpenRowId((cur) => (cur === d.id ? null : d.id))}
                      >
                        Review
                      </button>
                    )}
                  </td>
                  <td>{formatTurnLabel(d.turnNumber, d.turnPhase)}</td>
                  <td>{d.characterName}</td>
                  <td>{d.factionName || "-"}</td>
                  <td className="max-w-xs truncate">{d.description}</td>
                  <td>{STATUS_LABELS[d.status] ?? d.status}</td>
                  <td>{d.pointsAwarded ?? "-"}</td>
                </tr>
                {openRowId === d.id && (
                  <tr>
                    <td colSpan={7}>
                      <form
                        action={adjudicateDesire}
                        className="flex flex-col gap-3 py-3"
                        onSubmit={() => setOpenRowId(null)}
                      >
                        <input type="hidden" name="desireId" value={d.id} />
                        <label className="field" style={{ width: "8rem" }}>
                          <span className="field-label">Significance ({DESIRE_MIN_POINTS}-{DESIRE_MAX_POINTS})</span>
                          <input type="number" name="points" min={DESIRE_MIN_POINTS} max={DESIRE_MAX_POINTS} defaultValue={DESIRE_MIN_POINTS} />
                        </label>
                        <label className="field">
                          <span className="field-label">Message to {d.characterName}</span>
                          <textarea name="message" rows={2} />
                        </label>
                        <label className="field">
                          <span className="field-label">GM notes (private)</span>
                          <textarea name="gmNotes" rows={2} />
                        </label>
                        <div className="flex gap-2">
                          <button type="submit" name="decision" value="approve" className="btn">
                            Approve
                          </button>
                          <button type="submit" name="decision" value="reject" className="btn-quiet">
                            Reject
                          </button>
                        </div>
                      </form>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={7} className="text-center" style={{ color: "var(--muted)" }}>
                  No desires match these filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
