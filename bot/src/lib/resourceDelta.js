// Parses "+N"/"-N"/"plus N"/"minus N" tokens out of a submitted move/effort
// message, sums them into one delta (e.g. "+1 +4 -3" -> +2), and returns the
// description with those tokens stripped so the GM sees clean prose.
//
// The signed-number form requires a whitespace/string boundary on both sides
// so hyphenated words in prose (e.g. "Sector-9") aren't misread as a delta.
const TOKEN_RE = /(^|\s)([+-]\d+)(?=\s|$)|\b(plus|minus)\s+(\d+)\b/gi;

function parseResourceDelta(text) {
  let delta = 0;
  let matched = false;

  const stripped = text.replace(TOKEN_RE, (_match, pre, signed, word, num) => {
    matched = true;
    if (signed) {
      delta += Number.parseInt(signed, 10);
      return pre;
    }
    delta += (word.toLowerCase() === "minus" ? -1 : 1) * Number.parseInt(num, 10);
    return "";
  });

  return {
    description: stripped.replace(/\s{2,}/g, " ").trim(),
    resourceDelta: matched ? delta : null,
  };
}

module.exports = { parseResourceDelta };
