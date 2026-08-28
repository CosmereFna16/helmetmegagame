"use client";

import { useEffect, useRef } from "react";
import FactionLink from "@/app/components/FactionLink";
import CharacterLink from "@/app/components/CharacterLink";

// The all-factions overview, the Factions tab of the Players panel.
//
// It used to be the GM branch of /faction. That page now redirects a GM here,
// so this is the only copy. /faction still has the per-faction detail view a
// player reaches by clicking a faction name; a GM stays in this desk
// instead — highlightFactionId/onSelectFaction (RosterTable.js) mark and
// scroll to a row here rather than opening that page.

// Same tint the desk uses for a claimed conversation row — color-mix over
// --accent-text rather than a dedicated background token, since none exists
// for this weight of highlight (globals.css).
const HIGHLIGHT_STYLE = { background: "color-mix(in srgb, var(--accent-text) 14%, transparent)" };

function buildChildrenMap(factions) {
  const map = new Map();
  for (const f of factions) {
    const key = f.parentFactionId ?? null;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(f);
  }
  return map;
}

// Renders a faction row plus its subject factions indented beneath it,
// recursively — keeps the hierarchy visible in the flat overview table
// instead of needing a separate page per level.
function FactionRows({ factions, childrenMap, depth, showSilo, highlightFactionId, onSelectFaction }) {
  return factions.flatMap((f) => {
    const leader = f.characters.find((c) => c.isLeader);
    const children = childrenMap.get(f.id) ?? [];
    return [
      <tr
        key={f.id}
        id={`faction-row-${f.id}`}
        style={f.id === highlightFactionId ? HIGHLIGHT_STYLE : undefined}
      >
        <td style={{ paddingLeft: `calc(10px + ${depth * 1.25}rem)` }}>
          {depth > 0 ? "↳ " : ""}
          <FactionLink factionId={f.id} name={f.name} onSelect={onSelectFaction} />
        </td>
        <td>{f.characters.length}</td>
        <td>
          <CharacterLink characterId={leader?.id} name={leader?.name ?? "-"} isGm />
        </td>
        {showSilo && <td>{f.silo} ⬢</td>}
      </tr>,
      ...FactionRows({
        factions: children,
        childrenMap,
        depth: depth + 1,
        showSilo,
        highlightFactionId,
        onSelectFaction,
      }),
    ];
  });
}

export default function FactionsPanel({ factions, highlightFactionId, onSelectFaction }) {
  const unaffiliated = factions.filter((f) => f.name === "Unaffiliated");
  const rest = factions.filter((f) => f.name !== "Unaffiliated");
  const childrenMap = buildChildrenMap(rest);
  const topLevel = rest.filter((f) => !f.parentFactionId);
  const tableRef = useRef(null);

  // Scroll the highlighted row into view whenever the selection changes —
  // arriving here from another player-desk route (the Dossier column) or a
  // click on this same table both land on the row, not just the tab.
  useEffect(() => {
    if (!highlightFactionId || !tableRef.current) return;
    const row = tableRef.current.querySelector(`#faction-row-${highlightFactionId}`);
    row?.scrollIntoView({ block: "nearest" });
  }, [highlightFactionId]);

  return (
    <div className="panel overflow-x-auto" ref={tableRef}>
      <table className="data-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Members</th>
            <th>Leader</th>
            <th>Silo</th>
          </tr>
        </thead>
        <tbody>
          {FactionRows({
            factions: topLevel,
            childrenMap,
            depth: 0,
            showSilo: true,
            highlightFactionId,
            onSelectFaction,
          })}
          {unaffiliated.map((f) => {
            const leader = f.characters.find((c) => c.isLeader);
            return (
              <tr
                key={f.id}
                id={`faction-row-${f.id}`}
                style={{
                  borderTop: "2px solid var(--border)",
                  ...(f.id === highlightFactionId ? HIGHLIGHT_STYLE : {}),
                }}
              >
                <td>
                  <FactionLink factionId={f.id} name={f.name} onSelect={onSelectFaction} />
                </td>
                <td>{f.characters.length}</td>
                <td>
                  <CharacterLink characterId={leader?.id} name={leader?.name ?? "-"} isGm />
                </td>
                <td>{f.silo} ⬢</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
