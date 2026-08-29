"use client";

import StatusPill from "@/app/components/StatusPill";
import { MOVE_REVIEW_LABELS, MOVE_REVIEW_TONES, moveKindLabel } from "@/lib/moves";
import { REQUEST_TYPE_LABELS, REQUEST_STATUS_LABELS, REQUEST_STATUS_TONES } from "@/lib/requestLabels";

import { useState } from "react";
import Link from "next/link";
import { TableScroll } from "@/app/components/DataTable";

// Read-only history, four sub-sections behind one selector. Everything here
// already has a full-fidelity home elsewhere (/gm/turns, /gm/audit,
// /gm/messages); this is the per-character slice, so a GM working one player
// doesn't have to go filter three other pages to see what they've been doing.
//
// Server-capped at 100 rows each (50 for DMs) and rendered as-is: a table
// this short doesn't need useTableState, and paging it would imply a
// completeness this deliberately doesn't claim.
const SECTIONS = ["Moves", "Requests", "Audit", "Messages"];

export default function RecordTab({ moves, requests, auditLog, messages, discordUserId }) {
  const [section, setSection] = useState("Moves");

  return (
    <>
      <div className="panel flex flex-wrap items-center justify-between gap-2 p-3">
        <div className="flex flex-wrap gap-2">
          {SECTIONS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setSection(s)}
              className={s === section ? "btn" : "btn-quiet"}
            >
              {s}
            </button>
          ))}
        </div>
        {section === "Messages" && (
          <Link href={`/gm/players/${discordUserId}`} className="btn-quiet">
            Full conversation
          </Link>
        )}
      </div>

      {section === "Moves" && (
        <Table
          empty="No Moves filed yet."
          rows={moves}
          head={["Turn", "Kind", "Status", "⬢", "Move"]}
          row={(m) => [
            m.turn,
            moveKindLabel(m.moveKind, m.gmNotes),
            <StatusPill
              key="status"
              tone={MOVE_REVIEW_TONES[MOVE_REVIEW_LABELS[m.status]] ?? "neutral"}
            >
              {MOVE_REVIEW_LABELS[m.status] ?? m.status}
            </StatusPill>,
            m.resourceDelta ? `${m.resourceDelta > 0 ? "+" : ""}${m.resourceDelta}` : "—",
            m.description,
          ]}
        />
      )}

      {section === "Requests" && (
        <Table
          empty="No Requests made yet."
          rows={requests}
          head={["Turn", "Type", "Status", "Reason"]}
          row={(r) => [
            r.turn,
            REQUEST_TYPE_LABELS[r.type] ?? r.type,
            <StatusPill key="status" tone={REQUEST_STATUS_TONES[r.status] ?? "neutral"}>
              {REQUEST_STATUS_LABELS[r.status] ?? r.status}
            </StatusPill>,
            r.reason ?? "—",
          ]}
        />
      )}

      {section === "Audit" && (
        <Table
          empty="Nothing recorded against this character."
          rows={auditLog}
          head={["When", "Action", "Reason"]}
          row={(a) => [new Date(a.createdAt).toLocaleString(), a.actionType, a.reason ?? "—"]}
        />
      )}

      {section === "Messages" && (
        <Table
          empty="No DMs either way."
          rows={messages}
          head={["When", "Direction", "Message"]}
          row={(m) => [new Date(m.createdAt).toLocaleString(), m.direction, m.content]}
        />
      )}
    </>
  );
}

function Table({ rows, head, row, empty }) {
  if (!rows.length) return <p className="text-sm text-muted">{empty}</p>;
  return (
    // TableScroll renders the <table> itself — pass it thead/tbody, never a
    // nested table.
    <TableScroll minWidth="640px">
      <thead>
        <tr>
          {head.map((h) => (
            <th key={h} scope="col">{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id}>
            {row(r).map((cell, i) => (
              // The last column is prose; the rest are data, so only they
              // take .mono (DESIGN-SYSTEM.md — mono is for data only).
              <td key={i} className={i === head.length - 1 ? undefined : "mono text-sm"}>
                {cell}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </TableScroll>
  );
}
