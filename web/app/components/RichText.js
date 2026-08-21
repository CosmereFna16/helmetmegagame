"use client";

import { useTags } from "./TagsProvider";
import { useProductionRates } from "./ProductionRatesProvider";
import TagChip from "./TagChip";
import ResourceChip from "./ResourceChip";

const BUBBLE_REF_RE = /\{(\w+):([^}]+)\}/g;

function TagToken({ payload, fallback }) {
  const { tagsById, tagsBySlug } = useTags();
  const key = payload.trim();
  const tag = tagsById.get(key) ?? tagsBySlug.get(key);
  return tag ? <TagChip tag={tag} /> : fallback;
}

// Payload is "field:tier", e.g. "herding:laborer" — see
// db/lib/production.js's PRODUCTION_RATES for the field/tier names.
function ResourceToken({ payload, fallback }) {
  const { rates } = useProductionRates();
  const [field, tier] = payload.split(":").map((p) => p.trim());
  const value = rates[field]?.[tier];
  if (value == null) return fallback;
  return <ResourceChip value={value} label={`${field} — ${tier}`} />;
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
export default function RichText({ text, as: Tag = "span" }) {
  if (!text) return null;

  const parts = [];
  let lastIndex = 0;

  for (const match of text.matchAll(BUBBLE_REF_RE)) {
    if (match.index > lastIndex) parts.push(text.slice(lastIndex, match.index));

    const [full, kind, payload] = match;
    const Token = BUBBLE_KINDS[kind];
    parts.push(
      Token ? <Token key={`${kind}-${payload}-${match.index}`} payload={payload} fallback={full} /> : full,
    );

    lastIndex = match.index + full.length;
  }
  if (lastIndex < text.length) parts.push(text.slice(lastIndex));

  return <Tag>{parts}</Tag>;
}
