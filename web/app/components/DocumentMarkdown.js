"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkTokens from "./remarkTokens";
import { useTags } from "./TagsProvider";
import { useProductionRates } from "./ProductionRatesProvider";
import { usePartySizes } from "./PartySizeProvider";
import { useDocuments } from "./DocumentsProvider";
import TagChip from "./TagChip";
import ResourceChip from "./ResourceChip";
import PartySizeChip from "./PartySizeChip";
import DocumentChip from "./DocumentChip";
import InfoIcon from "./InfoIcon";
import { toString as mdastToString } from "mdast-util-to-string";
import { slugifyHeading } from "@/lib/documentHeadings";

// Renders a <richtoken> node (see remarkTokens.js) the same way RichText
// renders a {kind:payload} token outside Markdown: a {tag:...} becomes a
// hoverable TagChip, a {resource:field:tier} becomes a live ResourceChip, and
// a {partysize:N} becomes a live PartySizeChip.
function RichTokenRenderer({ kind, payload, raw }) {
  const { tagsById, tagsBySlug } = useTags();
  const { rates } = useProductionRates();
  const { sizes } = usePartySizes();
  const { docsByKey } = useDocuments();

  if (kind === "tag") {
    const key = payload.trim();
    const tag = tagsById.get(key) ?? tagsBySlug.get(key);
    return tag ? <TagChip tag={tag} /> : raw;
  }

  if (kind === "resource") {
    const [field, tier] = payload.split(":").map((p) => p.trim());
    const rate = rates[field]?.[tier];
    if (!rate) return raw;
    return <ResourceChip value={rate.display} />;
  }

  if (kind === "partysize") {
    const size = sizes[payload.trim()];
    if (!size) return raw;
    return <PartySizeChip value={size.display} />;
  }

  if (kind === "document") {
    const doc = docsByKey.get(payload.trim());
    return doc ? <DocumentChip doc={doc} /> : raw;
  }

  // {info:some sentence} — a "?" glyph carrying its own payload as the
  // tooltip, for a footnote that would clutter the line it explains (a table
  // cell, most often). The only token whose payload is prose rather than a
  // lookup key, so it never fails to resolve.
  if (kind === "info") return <InfoIcon text={payload.trim()} />;

  return raw;
}

function TableRenderer({ node, ...props }) {
  // The page body never scrolls sideways (DESIGN-SYSTEM.md §9) — a handbook
  // table wide enough to overflow the .doc-sheet scrolls inside this wrapper
  // instead of widening the sheet. Plain overflow-x-auto, not .table-scroll:
  // that class also clips vertically to --list-h and pins the header for a
  // long data grid, which is the wrong frame for a short document table.
  return (
    <div className="overflow-x-auto">
      <table className="data-table" {...props} />
    </div>
  );
}

// h1/h2/h3 -> a GitHub-style id, so an authored `[x](#y)` link inside a
// document (docs/handbook.md's own Table of Contents) and a generated sheet
// ToC (documentHeadings.js) both land on a real target. Slugged off the mdast
// node's text (mdastToString), not the rendered React children — a heading
// containing an inline code span would otherwise slug differently here than
// in documentHeadings.js, which also reads off the raw tree.
function makeHeading(Tag) {
  return function Heading({ node, children, ...props }) {
    const id = node ? slugifyHeading(mdastToString(node)) : undefined;
    return (
      <Tag id={id} {...props}>
        {children}
      </Tag>
    );
  };
}

// A same-document `#anchor` link scrolls the nearest scrollable ancestor by
// default, which inside the .doc-sheet modal is the sheet itself — so this
// only needs to stop the browser's own jump (which would otherwise also try
// to move the page behind the modal) and hand off to scrollIntoView.
function AnchorLink({ href, children, ...props }) {
  if (!href?.startsWith("#")) {
    return (
      <a href={href} {...props}>
        {children}
      </a>
    );
  }
  return (
    <a
      href={href}
      {...props}
      onClick={(e) => {
        e.preventDefault();
        document.getElementById(href.slice(1))?.scrollIntoView({ block: "start" });
      }}
    >
      {children}
    </a>
  );
}

// Full GFM Markdown (tables, lists, bold/italic, links, headings, ...) for a
// document's description, plus the {tag:...}/{resource:...} inline tokens
// RichText/ChipText resolve elsewhere in the app — remarkTokens.js folds
// those into the same tree Markdown renders from, so a token inside a table
// cell or a list item resolves exactly like one in plain prose.
//
// Never rendered inside a <button> (see DocumentsBoard.js's card preview,
// which uses documentPreview.js's plain-text extraction instead) — TagChip/
// ResourceChip are focusable, and Markdown itself can emit <a>/<table>,
// none of which are legal inside interactive content.
export default function DocumentMarkdown({ text }) {
  if (!text) return null;

  return (
    <div className="markdown-content">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkTokens]}
        disallowedElements={["img"]}
        unwrapDisallowed
        components={{
          richtoken: RichTokenRenderer,
          table: TableRenderer,
          h1: makeHeading("h1"),
          h2: makeHeading("h2"),
          h3: makeHeading("h3"),
          a: AnchorLink,
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
