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

// Extracts a single dice expression like "1d6", "1d6*2", "1d6 + 2", "2d8-1"
// out of a submitted message — general resource-request dice notation (not
// tied to any one activity), for cases where a flat +N isn't precise enough
// and the player wants to roll for it instead. Strips it from the
// description and returns a canonical expression string ("1d6*2") to be
// rolled later at confirm time (see rollResourceDice) rather than now — the
// point is the roll happens after the player commits via ⚜, same timing as
// the existing Move dice roll.
const DICE_RE = /(^|\s)([+-])?(\d*)d(\d+)(?:\s*([*+-])\s*(\d+))?(?=\s|$)/i;

function parseResourceDice(text) {
  const match = DICE_RE.exec(text);
  if (!match) return { description: text, resourceDiceExpression: null };

  const [full, pre, sign, countStr, sidesStr, op, modStr] = match;
  const count = countStr ? Number.parseInt(countStr, 10) : 1;
  const sides = Number.parseInt(sidesStr, 10);
  const expression = `${sign === "-" ? "-" : ""}${count}d${sides}${op ? `${op}${modStr}` : ""}`;

  const start = match.index + pre.length;
  const stripped = text.slice(0, start) + text.slice(match.index + full.length);

  return {
    description: stripped.replace(/\s{2,}/g, " ").trim(),
    resourceDiceExpression: expression,
  };
}

const EXPR_RE = /^(-)?(\d+)d(\d+)(?:([*+-])(\d+))?$/i;

// Rolls a canonical expression produced by parseResourceDice. Returns null
// if the stored expression is somehow malformed (shouldn't happen since it's
// always machine-generated, but callers should still guard for it).
function rollResourceDice(expression) {
  const match = EXPR_RE.exec(expression);
  if (!match) return null;

  const [, sign, countStr, sidesStr, op, modStr] = match;
  const count = Number.parseInt(countStr, 10);
  const sides = Number.parseInt(sidesStr, 10);
  const rolls = Array.from({ length: count }, () => 1 + Math.floor(Math.random() * sides));
  const sum = rolls.reduce((a, b) => a + b, 0);
  const mod = modStr ? Number.parseInt(modStr, 10) : null;
  const applied = op === "*" ? sum * mod : op === "+" ? sum + mod : op === "-" ? sum - mod : sum;

  return { rolls, sum, value: sign === "-" ? -applied : applied };
}

// Shared by the type-picker DM (submission) and the confirm DM (after type
// is chosen) — both show the same pending request info before the player
// hits ⚜, since the dice component isn't rolled until then.
function formatResourceLines(resourceDelta, resourceDiceExpression) {
  const lines = [];
  if (resourceDelta) lines.push(`**Resource change:** ${resourceDelta > 0 ? "+" : ""}${resourceDelta}`);
  if (resourceDiceExpression) lines.push(`**Resource roll:** ${resourceDiceExpression} (rolled once you confirm)`);
  return lines;
}

module.exports = { parseResourceDelta, parseResourceDice, rollResourceDice, formatResourceLines };
