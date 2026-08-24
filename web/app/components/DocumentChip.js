"use client";

import { useRouter } from "next/navigation";
import HoverCard from "./HoverCard";

// An inline reference to another document, from {document:key}.
//
// Unlike a TagChip this one actually goes somewhere: documents have a URL now
// (/documents?doc=key), so a reference in one paper can be followed to the
// paper it names.
//
// Navigation is an onClick on HoverCard's trigger rather than a <Link> inside
// it, the same way TagChip adds its consume click. The trigger span already
// carries tabIndex={0} so the tooltip can be reached by keyboard; nesting a
// focusable <a> inside it would make one chip two tab stops.
//
// `doc` comes from useDocuments() and is already resolved by the caller —
// see DocumentsProvider. A doc the reader may not open arrives with
// accessible:false and no body, and renders as an inert chip: the reference
// still reads as a reference, but there is nothing to follow. That is
// deliberate — degrading to plain text would hide that a document exists,
// while a working link would hand out Gamemaster briefs.
export default function DocumentChip({ doc }) {
  const router = useRouter();

  const face = (
    <span className="chip doc-chip" data-locked={!doc.accessible || undefined}>
      <span aria-hidden="true">▣</span>
      {doc.name}
    </span>
  );

  if (!doc.accessible) return face;

  const open = () => router.push(`/documents?doc=${encodeURIComponent(doc.key)}`);

  return (
    <HoverCard
      panel={
        <>
          <strong>{doc.name}</strong>
          {doc.source && <p className="text-muted">{doc.source}</p>}
          {doc.excerpt && <p>{doc.excerpt}</p>}
        </>
      }
      className="cursor-pointer"
      role="link"
      onClick={open}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          open();
        }
      }}
    >
      {face}
    </HoverCard>
  );
}
