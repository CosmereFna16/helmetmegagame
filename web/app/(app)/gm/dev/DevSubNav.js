import Link from "next/link";

// Shared nav for the three PageShell sub-pages this sits above — characters,
// factions, tags — plus a link back to the desk-style /gm/dev and one out to
// /gm/gamemasters. The Dev Panel's own OpsNav.js links to these three the
// other way ((desk)/gm/dev/OpsNav.js's "Elsewhere" group), so this is what
// makes the trip back symmetric.
//
// No "use client": a leaf of plain <Link>s, so every server-component
// sub-page can render it without joining a client bundle.
const ITEMS = [
  { key: "panel", href: "/gm/dev", label: "Dev Panel" },
  { key: "characters", href: "/gm/dev/characters", label: "Characters" },
  { key: "factions", href: "/gm/dev/factions", label: "Factions" },
  { key: "tags", href: "/gm/dev/tags", label: "Tags" },
  { key: "gamemasters", href: "/gm/gamemasters", label: "Gamemasters" },
];

export default function DevSubNav({ current }) {
  return (
    <nav className="flex flex-wrap items-center gap-4 text-sm">
      {ITEMS.map((item) =>
        item.key === current ? (
          <span key={item.key} className="menu-item text-muted" aria-current="page">
            {item.label}
          </span>
        ) : (
          <Link key={item.key} href={item.href} className="menu-item">
            {item.label}
          </Link>
        ),
      )}
    </nav>
  );
}
