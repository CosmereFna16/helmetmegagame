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

// A range like "5-12" (also "5 - 12", "+5-12", en/em dashes) — the player
// asking to roll for a payout instead of naming a flat number. Like the dice
// notation it replaced, it is parsed at submission and rolled at confirm
// (see rollResourceRange), so the roll lands only after the player commits
// via ⚜.
//
// Whitespace-bounded on both sides for the same reason TOKEN_RE is: the left
// operand has to be digits immediately preceded by whitespace/string-start,
// so hyphenated prose ("Sector-9") can't match. Matched once, not globally —
// one roll per message.
//
// Known and accepted: unlike the old "1d6", a bare "5-12" is also ordinary
// English ("in 5-12 turns"). Matching once bounds the damage, and the #turns
// path shows the parsed roll in the confirm DM before anything lands. The
// Default Move panel has no confirm step, so its tooltip says outright that
// a bare range reads as a roll.
const RANGE_RE = /(^|\s)\+?(\d+)\s*[-–—]\s*(\d+)(?=\s|$)/;

// The four labor shorthands. Typing "/hunt" in a Move (or as a Default Move)
// is the text twin of the /hunt slash command: the caller resolves it against
// the character's tags, location and the production coefficient, collapsing
// it into a concrete range before anything is stored — see
// db/lib/laborAccess.js#resolveLaborRate. Discord only treats a leading "/"
// as a command when the sender picks it out of the autocomplete popup, so a
// literal "/hunt" in a message body arrives as plain content.
const SHORTHAND_RE = /(^|\s)\/(hunt|fish|farm|herd)\b/i;

// Canonical stored form, always ASCII-hyphenated, always min-first. What
// rollResourceRange re-parses off the Action row.
const RANGE_EXPR_RE = /^(\d+)-(\d+)$/;

function stripMatch(text, match) {
  const pre = match[1];
  const start = match.index + pre.length;
  return text.slice(0, start) + text.slice(match.index + match[0].length);
}

// Extracts the roll component (a shorthand or a range, never both) plus any
// flat +N/-N deltas from a submitted message.
//
// Order matters: shorthand first, then a range only if no shorthand matched,
// then the flat deltas over what's left. Running parseResourceDelta on an
// unstripped "5-12" happens to be harmless today (the "-" is preceded by a
// digit, so TOKEN_RE misses it) but that's an accident of the guard, not a
// promise — strip first and it stays correct however TOKEN_RE changes.
//
// Returns { description, resourceDelta, roll }, where roll is null, or
// { kind: "shorthand", field, expression } — which the caller MUST resolve
// into a range before storing — or { kind: "range", min, max, expression }.
function parseResourceExpression(text) {
  let roll = null;
  let rest = text;

  const shorthand = SHORTHAND_RE.exec(rest);
  if (shorthand) {
    const field = shorthand[2].toLowerCase();
    roll = { kind: "shorthand", field, expression: `/${field}` };
    rest = stripMatch(rest, shorthand);
  } else {
    const range = RANGE_RE.exec(rest);
    if (range) {
      const a = Number.parseInt(range[2], 10);
      const b = Number.parseInt(range[3], 10);
      const min = Math.min(a, b);
      const max = Math.max(a, b);
      roll = { kind: "range", min, max, expression: `${min}-${max}` };
      rest = stripMatch(rest, range);
    }
  }

  const { description, resourceDelta } = parseResourceDelta(rest);
  return { description, resourceDelta, roll };
}

// Rolls a canonical range expression. Returns null if the stored expression
// is malformed — it's always machine-generated, but an Action row written
// before this notation existed (a leftover "1d4*3") lands here too, and
// callers already guard on a falsy result.
function rollResourceRange(expression) {
  const match = RANGE_EXPR_RE.exec(expression ?? "");
  if (!match) return null;

  const min = Number.parseInt(match[1], 10);
  const max = Number.parseInt(match[2], 10);
  return { min, max, value: min + Math.floor(Math.random() * (max - min + 1)) };
}

// Display form of a stored expression — en dash, matching how the same range
// renders in a document bubble (see db/lib/production.js#formatRate).
function formatRangeExpression(expression) {
  const match = RANGE_EXPR_RE.exec(expression ?? "");
  return match ? `${match[1]}–${match[2]}` : expression;
}

// Shared by the type-picker DM (submission) and the confirm DM (after type
// is chosen) — both show the same pending request info before the player
// hits ⚜, since the range isn't rolled until then.
function formatResourceLines(resourceDelta, resourceRollExpression) {
  const lines = [];
  if (resourceDelta) lines.push(`**Resource change:** ${resourceDelta > 0 ? "+" : ""}${resourceDelta} ⬢`);
  if (resourceRollExpression) {
    lines.push(`**Resource roll:** ${formatRangeExpression(resourceRollExpression)} ⬢ (rolled once you confirm)`);
  }
  return lines;
}

module.exports = {
  parseResourceDelta,
  parseResourceExpression,
  rollResourceRange,
  formatRangeExpression,
  formatResourceLines,
};
