// Shared `.desk-header` for the (desk) route group — /gm/turns, /gm/audit,
// /gm/players. Those three pages are one tool wearing three faces
// (ADJUDICATION.md / DESIGN-SYSTEM.md §6's "desk" exception to PageShell),
// and they used to hand-roll this header separately, which drifted: audit's
// <h1> was text-base, adjudication's was section-title, and the meta chips
// sat in different orders. This is the one place that layout lives now.
//
// Not "use client" — it renders whatever it's given, so it works from either
// a server or client parent.
export default function DeskHeader({ title, meta, actions }) {
  return (
    <header className="desk-header">
      <div className="flex min-w-0 items-center gap-3">
        <h1 className="section-title">{title}</h1>
        {meta}
      </div>
      <div className="flex flex-wrap items-center gap-2">{actions}</div>
    </header>
  );
}
