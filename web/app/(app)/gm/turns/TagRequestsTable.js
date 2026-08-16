"use client";

import { Fragment, useMemo, useState } from "react";
import { adjudicateTagChangeRequest } from "../actions";

const STATUS_LABELS = {
  PENDING: "Pending review",
  RESOLVED: "Resolved",
};

export default function TagRequestsTable({ requests }) {
  const [factionFilter, setFactionFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [openRowId, setOpenRowId] = useState(null);

  const factions = useMemo(
    () => [...new Set(requests.map((r) => r.factionName).filter(Boolean))].sort(),
    [requests],
  );

  const filtered = requests.filter(
    (r) => (!factionFilter || r.factionName === factionFilter) && (!statusFilter || r.status === statusFilter),
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
            <option value="PENDING">Pending review</option>
            <option value="RESOLVED">Resolved</option>
          </select>
        </label>
      </div>

      <div className="panel overflow-x-auto">
        <table className="data-table" style={{ minWidth: "900px" }}>
          <thead>
            <tr>
              <th></th>
              <th>Character</th>
              <th>Faction</th>
              <th>Requested by</th>
              <th>Description</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => (
              <Fragment key={r.id}>
                <tr>
                  <td>
                    {r.status === "PENDING" && (
                      <button
                        type="button"
                        className="status-link"
                        onClick={() => setOpenRowId((cur) => (cur === r.id ? null : r.id))}
                      >
                        Review
                      </button>
                    )}
                  </td>
                  <td>{r.characterName}</td>
                  <td>{r.factionName || "-"}</td>
                  <td>{r.requestedByName}</td>
                  <td className="max-w-xs truncate">{r.description}</td>
                  <td>{STATUS_LABELS[r.status] ?? r.status}</td>
                </tr>
                {openRowId === r.id && (
                  <tr>
                    <td colSpan={6}>
                      <form
                        action={adjudicateTagChangeRequest}
                        className="flex flex-col gap-3 py-3"
                        onSubmit={() => setOpenRowId(null)}
                      >
                        <input type="hidden" name="requestId" value={r.id} />
                        <label className="field">
                          <span className="field-label">Message to {r.characterName}</span>
                          <textarea name="message" rows={2} />
                        </label>
                        <label className="field">
                          <span className="field-label">GM notes (private)</span>
                          <textarea name="gmNotes" rows={2} />
                        </label>
                        <div className="flex gap-2">
                          <button type="submit" className="btn">
                            Mark Resolved
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
                <td colSpan={6} className="text-center" style={{ color: "var(--muted)" }}>
                  No tag change requests match these filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
