// The stored-expression half of what used to be a full text-notation parser.
// A Labor roll is stored as a canonical "min-max" range on
// Action.resourceRollExpression / DefaultEffort — resolved once at submit
// time (db/lib/laborAccess.js), rolled once at confirm
// (bot/src/lib/moveConfirm.js) or at the Default Move pass
// (db/lib/defaultMovePass.js). Nothing in the arbitration desk parses text:
// StagedEffect stages a numeric delta directly and Action columns are read
// for display only, so this file no longer needs to understand player-typed
// notation at all.

// Canonical stored form, always ASCII-hyphenated, always min-first.
const RANGE_EXPR_RE = /^(\d+)-(\d+)$/;

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

module.exports = {
  rollResourceRange,
  formatRangeExpression,
};
