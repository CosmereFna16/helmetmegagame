"use client";

import { useTags } from "./TagsProvider";
import { useProductionRates } from "./ProductionRatesProvider";
import ChipLabel from "./ChipLabel";
import ResourceChip from "./ResourceChip";
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
      const value = rates[field]?.[tier];
      if (value == null) return part.raw;
      return <ResourceChip key={`r-${i}`} value={value} label={`${field} — ${tier}`} />;
    }

    return part.raw;
  });

  return <Wrapper className={className}>{parts}</Wrapper>;
}
