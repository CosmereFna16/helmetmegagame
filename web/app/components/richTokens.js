// The {kind:payload} inline-reference syntax, split from its rendering.
//
// Two components resolve these tokens, and they differ only in what a
// {tag:...} becomes:
//
//   RichText.js — a full, hoverable TagChip. For prose the reader can point
//     at: documents, a character's appearance.
//   ChipText.js — a bare ChipLabel with no tooltip of its own. For places
//     where an interactive chip is illegal or useless: inside another chip's
//     hover tooltip, or inside the <button> that is a point-buy row.
//
// The parser lives here rather than in either of them because RichText
// renders TagChip and TagChip renders ChipText — importing one from the other
// would close that loop into an import cycle.
//
// remarkTokens.js is a third consumer, resolving the same syntax inside
// Markdown documents. It builds its own RegExp from TOKEN_SOURCE rather than
// sharing a compiled instance with splitTokens below — a `g`-flag RegExp
// carries mutable `lastIndex` state, and mdast-util-find-and-replace's
// exec-loop and this file's matchAll loop have no business sharing it.
// One kind is not a reference at all: {info:…} carries its own tooltip
// sentence as the payload and renders a "?" glyph. It is for prose the reader
// can hover — RichText and DocumentMarkdown render it, ChipText drops it.
export const TOKEN_SOURCE = "\\{(\\w+):([^}]+)\\}";

// Returns an ordered list of parts: { text } for literal runs, and
// { kind, payload, raw } for each token. `raw` is the token exactly as
// written, which is what a caller renders when it can't resolve one — an
// unresolved reference should be visible, not silently dropped.
export function splitTokens(text) {
  const parts = [];
  let lastIndex = 0;

  for (const match of text.matchAll(new RegExp(TOKEN_SOURCE, "g"))) {
    if (match.index > lastIndex) parts.push({ text: text.slice(lastIndex, match.index) });
    const [raw, kind, payload] = match;
    parts.push({ kind, payload, raw, index: match.index });
    lastIndex = match.index + raw.length;
  }
  if (lastIndex < text.length) parts.push({ text: text.slice(lastIndex) });

  return parts;
}
