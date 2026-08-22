"use client";

import { useTags } from "./TagsProvider";
import { useProductionRates } from "./ProductionRatesProvider";
import { usePartySizes } from "./PartySizeProvider";
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

    return part.raw;
  });

  return <Wrapper className={className}>{parts}</Wrapper>;
}
