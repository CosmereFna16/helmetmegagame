"use client";

import { useState } from "react";
import TurnsTable from "./TurnsTable";
import AdjudicationsTable from "./AdjudicationsTable";
import DesiresTable from "./DesiresTable";

export default function AdjudicatePanel({ actions, adjudications, desires }) {
  const [tab, setTab] = useState("actions");
  const [highlightId, setHighlightId] = useState(null);

  function showAdjudication(actionId) {
    setHighlightId(actionId);
    setTab("completed");
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="tab-bar">
        <button type="button" className="tab-item" data-active={tab === "actions"} onClick={() => setTab("actions")}>
          Actions
        </button>
        <button
          type="button"
          className="tab-item"
          data-active={tab === "completed"}
          onClick={() => setTab("completed")}
        >
          Completed
        </button>
        <button type="button" className="tab-item" data-active={tab === "desires"} onClick={() => setTab("desires")}>
          Desires
        </button>
      </div>

      {tab === "actions" && <TurnsTable actions={actions} onShowAdjudication={showAdjudication} />}
      {tab === "completed" && <AdjudicationsTable entries={adjudications} highlightId={highlightId} />}
      {tab === "desires" && <DesiresTable desires={desires} />}
    </div>
  );
}
