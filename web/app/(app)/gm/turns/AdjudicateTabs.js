"use client";

import { useState } from "react";
import MovesTable from "./MovesTable";
import RequestsTable from "./RequestsTable";
import RequestPanel from "./RequestPanel";
import MovePanel from "./MovePanel";

export default function AdjudicateTabs({ moves, requests, initialTab }) {
  const [tab, setTab] = useState(initialTab === "requests" ? "requests" : "moves");
  // { row, readOnly } — the eye opens the same panel as the scale/edit icon
  // with every control inert, so there's one panel per type rather than a
  // second read-only rendering to keep in step.
  const [open, setOpen] = useState(null);

  const show = (row, readOnly) => setOpen({ row, readOnly });
  const close = () => setOpen(null);

  return (
    <div className="flex flex-col gap-4">
      <div className="tab-bar">
        <button
          type="button"
          className="tab-item"
          data-active={tab === "moves"}
          onClick={() => setTab("moves")}
        >
          Moves ({moves.length})
        </button>
        <button
          type="button"
          className="tab-item"
          data-active={tab === "requests"}
          onClick={() => setTab("requests")}
        >
          Requests ({requests.length})
        </button>
      </div>

      {tab === "moves" ? (
        <MovesTable
          moves={moves}
          onAdjudicate={(row) => show(row, false)}
          onView={(row) => show(row, true)}
        />
      ) : (
        <RequestsTable
          requests={requests}
          onReview={(row) => show(row, false)}
          onView={(row) => show(row, true)}
        />
      )}

      {open && tab === "moves" && (
        <MovePanel move={open.row} readOnly={open.readOnly} onClose={close} />
      )}
      {open && tab === "requests" && (
        <RequestPanel request={open.row} readOnly={open.readOnly} onClose={close} />
      )}
    </div>
  );
}
