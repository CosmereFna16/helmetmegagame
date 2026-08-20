"use client";

import { useState } from "react";
import MovesTable from "./MovesTable";
import RequestsTable from "./RequestsTable";
import RequestPanel from "./RequestPanel";

export default function AdjudicateTabs({ moves, requests, initialTab }) {
  const [tab, setTab] = useState(initialTab === "requests" ? "requests" : "moves");
  const [reviewing, setReviewing] = useState(null);

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
        // The Move Adjudication Panel is Phase 2 — the scale button is wired
        // to nothing yet rather than being hidden, so the column layout the
        // GM learns now doesn't shift when it lands.
        <MovesTable moves={moves} onAdjudicate={null} />
      ) : (
        <RequestsTable requests={requests} onReview={setReviewing} />
      )}

      {reviewing && <RequestPanel request={reviewing} onClose={() => setReviewing(null)} />}
    </div>
  );
}
