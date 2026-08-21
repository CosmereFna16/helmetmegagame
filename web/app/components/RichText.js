"use client";

import { useTags } from "./TagsProvider";
import { useProductionRates } from "./ProductionRatesProvider";
import TagChip from "./TagChip";
import ResourceChip from "./ResourceChip";
import { splitTokens } from "./richTokens";

function TagToken({ payload, fallback }) {
  const { tagsById, tagsBySlug } = useTags();
  const key = payload.trim();
  const tag = tagsById.get(key) ?? tagsBySlug.get(key);
  return tag ? <TagChip tag={tag} /> : fallback;
}

// Payload is "field:tier", e.g. "herding:laborer" — see
// db/lib/production.js's PRODUCTION_RATES for the field/tier names. The API
// ships each tier pre-formatted as `display` ("3", or "0–4" when it rolls).
function ResourceToken({ payload, fallback }) {
  const { rates } = useProductionRates();
  const [field, tier] = payload.split(":").map((p) => p.trim());
  const rate = rates[field]?.[tier];
  if (!rate) return fallback;
  return <ResourceChip value={rate.display} />;
}

const BUBBLE_KINDS = {
  tag: TagToken,
  resource: ResourceToken,
};

// Renders plain text, except any {kind:payload} token (e.g. {tag:slug} or
// {resource:field:tier}) becomes an inline bubble widget. Each kind owns its
// own lookup/rendering (TagToken, ResourceToken, ...) so new kinds can be
// added without touching this dispatch logic. Unknown kinds and unresolved
// payloads are left as literal text (rather than silently dropped) so a bad
// reference is easy to spot.
//
// This is the full-fat renderer: a {tag:…} becomes a hoverable TagChip. Text
// that already lives inside a tooltip or a button wants ChipText instead —
// see richTokens.js, which holds the parser both share.
export default function RichText({ text, as: Tag = "span" }) {
  if (!text) return null;

  const parts = splitTokens(text).map((part, i) => {
    if (part.text !== undefined) return part.text;
    const Token = BUBBLE_KINDS[part.kind];
    if (!Token) return part.raw;
    return (
      <Token key={`${part.kind}-${part.payload}-${i}`} payload={part.payload} fallback={part.raw} />
    );
  });

  return <Tag>{parts}</Tag>;
}
