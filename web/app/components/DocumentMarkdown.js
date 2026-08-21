"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkTokens from "./remarkTokens";
import { useTags } from "./TagsProvider";
import { useProductionRates } from "./ProductionRatesProvider";
import TagChip from "./TagChip";
import ResourceChip from "./ResourceChip";

// Renders a <richtoken> node (see remarkTokens.js) the same way RichText
// renders a {kind:payload} token outside Markdown: a {tag:...} becomes a
// hoverable TagChip, a {resource:field:tier} becomes a live ResourceChip.
function RichTokenRenderer({ kind, payload, raw }) {
  const { tagsById, tagsBySlug } = useTags();
  const { rates } = useProductionRates();

  if (kind === "tag") {
    const key = payload.trim();
    const tag = tagsById.get(key) ?? tagsBySlug.get(key);
    return tag ? <TagChip tag={tag} /> : raw;
  }

  if (kind === "resource") {
    const [field, tier] = payload.split(":").map((p) => p.trim());
    const value = rates[field]?.[tier];
    if (value == null) return raw;
    return <ResourceChip value={value} label={`${field} — ${tier}`} />;
  }

  return raw;
}

function TableRenderer({ node, ...props }) {
  return <table className="data-table" {...props} />;
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
        components={{ richtoken: RichTokenRenderer, table: TableRenderer }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
