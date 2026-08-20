// Sentence-start capitalization only, applied to Tupper-proxied messages
// when GameConfig.tupperAutocorrectEnabled is on (bot/src/lib/proxy.js).
// Skips code blocks/inline code and URLs so it never mangles either.

const SKIP_SEGMENT = /```[\s\S]*?```|`[^`]*`|https?:\/\/\S+/g;

function capitalizeSegment(segment) {
  // Capitalize the first letter, and the first letter after ./!/? followed
  // by whitespace — deliberately conservative: no attempt at abbreviations
  // like "e.g." or decimal numbers, since a false positive there is worse
  // than leaving a lowercase letter alone.
  return segment.replace(/(^\s*|[.!?]\s+)([a-z])/g, (match, lead, letter) => lead + letter.toUpperCase());
}

function capitalizeSentences(content) {
  if (!content) return content;

  let result = "";
  let lastIndex = 0;
  for (const match of content.matchAll(SKIP_SEGMENT)) {
    result += capitalizeSegment(content.slice(lastIndex, match.index));
    result += match[0];
    lastIndex = match.index + match[0].length;
  }
  result += capitalizeSegment(content.slice(lastIndex));

  return result;
}

module.exports = { capitalizeSentences };
