"use client";

import { useState } from "react";

// The two halves are passed in as already-rendered nodes rather than data, so
// both tables stay server components — this file only owns which one is
// visible. `initialTab` comes from ?tab=, which is how /faction hands a GM
// straight to the Factions side.
export default function PlayersTabs({ initialTab, players, factions, playerCount, factionCount }) {
  const [tab, setTab] = useState(initialTab === "factions" ? "factions" : "players");

  const TABS = [
    { key: "players", label: `Players (${playerCount})` },
    { key: "factions", label: `Factions (${factionCount})` },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="tab-bar" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={t.key === tab}
            data-active={t.key === tab}
            className="tab-item"
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "players" ? players : factions}
    </div>
  );
}
