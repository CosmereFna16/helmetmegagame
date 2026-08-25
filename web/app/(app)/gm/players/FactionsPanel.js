// The all-factions overview, the Factions tab of the Players panel.
//
// It used to be the GM branch of /faction. That page now redirects a GM here,
// so this is the only copy — /faction keeps the per-faction detail view both
// roles reach by clicking a faction name.

import FactionLink from "@/app/components/FactionLink";
import CharacterLink from "@/app/components/CharacterLink";

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
function FactionRows({ factions, childrenMap, depth, showSilo }) {
  return factions.flatMap((f) => {
    const leader = f.characters.find((c) => c.isLeader);
    const children = childrenMap.get(f.id) ?? [];
    return [
      <tr key={f.id}>
        <td style={{ paddingLeft: `calc(10px + ${depth * 1.25}rem)` }}>
          {depth > 0 ? "↳ " : ""}
          <FactionLink factionId={f.id} name={f.name} />
        </td>
        <td>{f.characters.length}</td>
        <td>
          <CharacterLink characterId={leader?.id} name={leader?.name ?? "-"} isGm />
        </td>
        {showSilo && <td>{f.silo} ⬢</td>}
      </tr>,
      ...FactionRows({ factions: children, childrenMap, depth: depth + 1, showSilo }),
    ];
  });
}

export default function FactionsPanel({ factions }) {
  const unaffiliated = factions.filter((f) => f.name === "Unaffiliated");
  const rest = factions.filter((f) => f.name !== "Unaffiliated");
  const childrenMap = buildChildrenMap(rest);
  const topLevel = rest.filter((f) => !f.parentFactionId);

  return (
    <div className="panel overflow-x-auto">
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
          {FactionRows({ factions: topLevel, childrenMap, depth: 0, showSilo: true })}
          {unaffiliated.map((f) => {
            const leader = f.characters.find((c) => c.isLeader);
            return (
              <tr key={f.id} style={{ borderTop: "2px solid var(--border)" }}>
                <td>
                  <FactionLink factionId={f.id} name={f.name} />
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
