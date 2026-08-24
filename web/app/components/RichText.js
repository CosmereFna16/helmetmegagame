"use client";

import { useTags } from "./TagsProvider";
import { useProductionRates } from "./ProductionRatesProvider";
import { usePartySizes } from "./PartySizeProvider";
import { useDocuments } from "./DocumentsProvider";
import TagChip from "./TagChip";
import ResourceChip from "./ResourceChip";
import PartySizeChip from "./PartySizeChip";
import DocumentChip from "./DocumentChip";
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

// Payload is the 1-indexed tier of a Cult of Bacchus party goal, e.g.
// "3" — see db/lib/partySize.js. The API ships each tier pre-formatted as
// `display`, already scaled by GameConfig.playerCount.
function PartySizeToken({ payload, fallback }) {
  const { sizes } = usePartySizes();
  const size = sizes[payload.trim()];
  if (!size) return fallback;
  return <PartySizeChip value={size.display} />;
}

// Payload is Document.key (docs/documents.yaml's `key:`), e.g.
// "courtstructure". The index carries every written document's name, but a
// body only for those the reader may open — see /api/documents.
function DocumentToken({ payload, fallback }) {
  const { docsByKey } = useDocuments();
  const doc = docsByKey.get(payload.trim());
  return doc ? <DocumentChip doc={doc} /> : fallback;
}

const BUBBLE_KINDS = {
  tag: TagToken,
  resource: ResourceToken,
  partysize: PartySizeToken,
  document: DocumentToken,
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
