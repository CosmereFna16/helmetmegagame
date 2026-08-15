"use client";

import { useState } from "react";
import TurnsTable from "./TurnsTable";
import AdjudicationsTable from "./AdjudicationsTable";

export default function AdjudicatePanel({ actions, adjudications }) {
  const [tab, setTab] = useState("actions");
  const [highlightId, setHighlightId] = useState(null);

  function showAdjudication(actionId) {
    setHighlightId(actionId);
    setTab("adjudications");
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
          data-active={tab === "adjudications"}
          onClick={() => setTab("adjudications")}
        >
          Adjudications
        </button>
      </div>

      {tab === "actions" ? (
        <TurnsTable actions={actions} onShowAdjudication={showAdjudication} />
      ) : (
        <AdjudicationsTable entries={adjudications} highlightId={highlightId} />
      )}
    </div>
  );
}
