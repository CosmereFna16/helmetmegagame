"use client";

import Link from "next/link";
import HoverCard from "./HoverCard";

// An inline reference to another document, from {document:key}.
//
// Unlike a TagChip this one actually goes somewhere: documents have a URL now
// (/documents?doc=key), so a reference in one paper can be followed to the
// paper it names.
//
// HoverCard's trigger click/Enter/Space now pins the tooltip open rather
// than navigating, so the "Open →" link lives inside the panel instead —
// reachable once pinning makes the panel interactive.
//
// `doc` comes from useDocuments() and is already resolved by the caller —
// see DocumentsProvider. A doc the reader may not open arrives with
// accessible:false and no body, and renders as an inert chip: the reference
// still reads as a reference, but there is nothing to follow. That is
// deliberate — degrading to plain text would hide that a document exists,
// while a working link would hand out Gamemaster briefs.
export default function DocumentChip({ doc }) {
  const face = (
    <span className="chip doc-chip" data-locked={!doc.accessible || undefined}>
      <span aria-hidden="true">▣</span>
      {doc.name}
    </span>
  );

  if (!doc.accessible) return face;

  return (
    <HoverCard
      panel={
        <>
          <strong>{doc.name}</strong>
          {doc.source && <p className="text-muted">{doc.source}</p>}
          {doc.excerpt && <p>{doc.excerpt}</p>}
          <Link href={`/documents?doc=${encodeURIComponent(doc.key)}`} className="btn-quiet">
            Open →
          </Link>
        </>
      }
    >
      {face}
    </HoverCard>
  );
}
