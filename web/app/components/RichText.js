"use client";

import { useTags } from "./TagsProvider";
import TagChip from "./TagChip";

const TAG_REF_RE = /\{tag:([^}]+)\}/g;

// Renders plain text, except any {tag:ID} or {tag:slug} token becomes a
// hoverable TagChip inline. Unknown/misspelled refs are left as literal
// text (rather than silently dropped) so a bad reference is easy to spot.
export default function RichText({ text, as: Tag = "span" }) {
  const { tagsById, tagsBySlug } = useTags();
  if (!text) return null;

  const parts = [];
  let lastIndex = 0;

  for (const match of text.matchAll(TAG_REF_RE)) {
    if (match.index > lastIndex) parts.push(text.slice(lastIndex, match.index));

    const key = match[1].trim();
    const tag = tagsById.get(key) ?? tagsBySlug.get(key);
    parts.push(tag ? <TagChip key={`${key}-${match.index}`} tag={tag} /> : match[0]);

    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) parts.push(text.slice(lastIndex));

  return <Tag>{parts}</Tag>;
}
