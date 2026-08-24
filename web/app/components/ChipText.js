"use client";

import { useTags } from "./TagsProvider";
import { useProductionRates } from "./ProductionRatesProvider";
import { usePartySizes } from "./PartySizeProvider";
import { useDocuments } from "./DocumentsProvider";
import ChipLabel from "./ChipLabel";
import ResourceChip from "./ResourceChip";
import PartySizeChip from "./PartySizeChip";
import { splitTokens } from "./richTokens";

// RichText's quiet twin: same {tag:…} / {resource:…} tokens, but a tag
// renders as a plain ChipLabel rather than a hoverable TagChip. See
// richTokens.js for which of the two a given call site wants — the short
// version is that this one is for text already living inside a tooltip or a
// button, where a second interactive element can't work.
//
// An unresolved token is left as literal text, same as RichText, so a bad
// reference is easy to spot rather than silently disappearing.
export default function ChipText({ text, as: Wrapper = "span", className }) {
  const { tagsById, tagsBySlug } = useTags();
  const { rates } = useProductionRates();
  const { sizes } = usePartySizes();
  const { docsByKey } = useDocuments();

  if (!text) return null;

  const parts = splitTokens(text).map((part, i) => {
    if (part.text !== undefined) return part.text;

    if (part.kind === "tag") {
      const key = part.payload.trim();
      const tag = tagsById.get(key) ?? tagsBySlug.get(key);
      return tag ? <ChipLabel key={`t-${i}`} tag={tag} /> : part.raw;
    }

    if (part.kind === "resource") {
      const [field, tier] = part.payload.split(":").map((p) => p.trim());
      const rate = rates[field]?.[tier];
      if (!rate) return part.raw;
      return <ResourceChip key={`r-${i}`} value={rate.display} />;
    }

    if (part.kind === "partysize") {
      const size = sizes[part.payload.trim()];
      if (!size) return part.raw;
      return <PartySizeChip key={`p-${i}`} value={size.display} />;
    }

    // Always the flat face, never DocumentChip: this renderer exists for text
    // inside a tooltip or a <button>, and a document chip is a link. A link
    // inside the /documents card button would be invalid markup and would
    // swallow the click that opens the card.
    if (part.kind === "document") {
      const doc = docsByKey.get(part.payload.trim());
      if (!doc) return part.raw;
      return (
        <span key={`d-${i}`} className="chip doc-chip" data-locked={!doc.accessible || undefined}>
          <span aria-hidden="true">▣</span>
          {doc.name}
        </span>
      );
    }

    return part.raw;
  });

  return <Wrapper className={className}>{parts}</Wrapper>;
}
