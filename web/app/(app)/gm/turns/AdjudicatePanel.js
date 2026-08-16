"use client";

import { useState } from "react";
import TurnsTable from "./TurnsTable";
import DesiresTable from "./DesiresTable";
import TagRequestsTable from "./TagRequestsTable";

export default function AdjudicatePanel({ actions, desires, tagRequests }) {
  const [tab, setTab] = useState("actions");

  return (
    <div className="flex flex-col gap-4">
      <div className="tab-bar">
        <button type="button" className="tab-item" data-active={tab === "actions"} onClick={() => setTab("actions")}>
          Actions
        </button>
        <button type="button" className="tab-item" data-active={tab === "desires"} onClick={() => setTab("desires")}>
          Desires
        </button>
        <button type="button" className="tab-item" data-active={tab === "tags"} onClick={() => setTab("tags")}>
          Tags
        </button>
      </div>

      {tab === "actions" && <TurnsTable actions={actions} />}
      {tab === "desires" && <DesiresTable desires={desires} />}
      {tab === "tags" && <TagRequestsTable requests={tagRequests} />}
    </div>
  );
}
