"use client";

import Link from "next/link";
import HoverCard from "./HoverCard";

// An inline reference to another document, from {document:key}.
//
// Unlike a TagChip this one goes somewhere: documents have a URL
// (/documents?doc=key). HoverCard's trigger pins the tooltip open rather
// than navigating, so the "Open →" link lives inside the panel.
//
// `doc` comes from useDocuments(), already resolved — see DocumentsProvider.
// An inaccessible doc renders as an inert chip (no link) rather than plain
// text, so its existence stays visible without exposing GM-only content.
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
