// The {kind:payload} inline-reference syntax, split from its rendering.
//
// RichText.js renders {tag:...} as a hoverable TagChip; ChipText.js renders a
// bare ChipLabel with no tooltip, for use inside another chip's tooltip. The
// parser lives here to avoid an import cycle (RichText renders TagChip, which
// renders ChipText).
// remarkTokens.js parses the same syntax for Markdown, with its own RegExp —
// a `g`-flag RegExp's mutable lastIndex can't be shared between exec loops.
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
