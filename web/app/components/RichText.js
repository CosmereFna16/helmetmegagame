"use client";

import { useTags } from "./TagsProvider";
import { useProductionRates } from "./ProductionRatesProvider";
import { useCarryReference } from "./CarryProvider";
import { useDocuments } from "./DocumentsProvider";
import { useCharacterMentions } from "./CharacterMentionsProvider";
import TagChip from "./TagChip";
import ResourceChip from "./ResourceChip";
import DocumentChip from "./DocumentChip";
import CharacterAvatar from "./CharacterAvatar";
import InfoIcon from "./InfoIcon";
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

// Payload is Document.key (docs/documents.yaml's `key:`), e.g.
// "courtstructure". The index carries every written document's name, but a
// body only for those the reader may open — see getDocumentIndex (lib/referenceData.js).
function DocumentToken({ payload, fallback }) {
  const { docsByKey } = useDocuments();
  const doc = docsByKey.get(payload.trim());
  return doc ? <DocumentChip doc={doc} /> : fallback;
}

// Payload is a Character.id. The lookup map comes from
// CharacterMentionsProvider, mounted only by /notes — its default is an
// empty Map, so a {char:…} anywhere else in the app just falls back to
// literal text like any other unresolved reference.
function CharToken({ payload, fallback }) {
  const mentionsById = useCharacterMentions();
  const character = mentionsById.get(payload.trim());
  if (!character) return fallback;
  return (
    <span className="inline-flex items-center gap-1 align-middle">
      <CharacterAvatar
        characterId={character.id}
        name={character.name}
        version={character.updatedAt}
        size={16}
      />
      <span>{character.name}</span>
    </span>
  );
}

// Payload is the tooltip sentence itself, not a lookup key — the one token
// that can never fail to resolve. It renders the shared "?" glyph, for a
// footnote that would clutter the line it explains.
function InfoToken({ payload }) {
  return <InfoIcon text={payload.trim()} />;
}

// Payload is a tag slug carrying Tag.carryBonus ("pack-mule", "cart").
// Renders the plain sentence "You can carry N more item tags, and M ⬢.",
// computed from the live GameConfig caps by getCarryReference
// (lib/referenceData.js) — see docs/systemdocs/CARRY.md.
function CarryToken({ payload, fallback }) {
  const { lines } = useCarryReference();
  return lines[payload.trim()] ?? fallback;
}

const BUBBLE_KINDS = {
  tag: TagToken,
  resource: ResourceToken,
  carry: CarryToken,
  document: DocumentToken,
  char: CharToken,
  info: InfoToken,
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
