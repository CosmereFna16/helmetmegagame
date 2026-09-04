import Link from "next/link";

// The Dev Panel's section rail — a plain server component, no "use client"
// and no usePathname: the active section comes from ?s=, already known by
// the page that renders this, not from the URL pathname (which never
// changes — every section is the same route).
const SECTIONS = [
  {
    title: "Game",
    items: [
      { key: "turn", label: "Turn" },
      { key: "config", label: "Configuration" },
      { key: "depot", label: "The Depot" },
    ],
  },
  {
    title: "Operations",
    items: [
      { key: "move", label: "Bulk move" },
      { key: "reports", label: "System reports" },
    ],
  },
  {
    title: "Threats",
    items: [
      { key: "assignments", label: "Assignments" },
      { key: "antagonists", label: "Antagonists" },
    ],
  },
];

const ELSEWHERE = [
  { href: "/gm/dev/characters", label: "Characters" },
  { href: "/gm/dev/factions", label: "Factions" },
  { href: "/gm/dev/tags", label: "Tags" },
  { href: "/gm/gamemasters", label: "Gamemasters" },
];

export default function OpsNav({ section }) {
  return (
    <nav className="ops-nav">
      {SECTIONS.map((group) => (
        <div key={group.title} className="ops-nav-group">
          <span className="ops-nav-title">{group.title}</span>
          {group.items.map((item) => (
            <Link
              key={item.key}
              href={`/gm/dev?s=${item.key}`}
              className="ops-nav-item"
              data-active={section === item.key ? "true" : undefined}
            >
              {item.label}
            </Link>
          ))}
        </div>
      ))}

      <div className="ops-nav-group">
        <span className="ops-nav-title">Elsewhere</span>
        {ELSEWHERE.map((item) => (
          <Link key={item.href} href={item.href} className="ops-nav-item ops-nav-item--away">
            {item.label} ↗
          </Link>
        ))}
      </div>

      <div className="ops-nav-group">
        <span className="ops-nav-title">Danger</span>
        <Link
          href="/gm/dev?s=danger"
          className="ops-nav-item"
          data-active={section === "danger" ? "true" : undefined}
        >
          Restart game
        </Link>
      </div>
    </nav>
  );
}
