// Turns-remaining formatting, for anywhere a tag's expiry is shown beside it
// (web tooltip, Discord inspect embed). Lives here — rather than in bot/ —
// since it pairs with formatTagRequirement.js in the same embed line, and
// web/lib/turnFormat.js is an ESM module carrying web-only theme helpers that
// the bot can't require.
//
// Deliberately duplicated by hand with web/lib/turnFormat.js's copies, same
// convention as formatTagRequirement and buildNickname: keeping the web copy
// dependency-free is what lets client components import it.

// Null when either side is unknown, so a tag that never expires (or a caller
// with no open turn) renders no expiry line at all rather than "0".
function turnsLeft(expiresTurn, currentTurn) {
  if (expiresTurn == null || currentTurn == null) return null;
  return Math.max(0, expiresTurn - currentTurn);
}

// "2 turns left" / "1 turn left" / "expires this turn".
function formatTurnsLeft(n) {
  if (n == null) return null;
  if (n === 0) return "expires this turn";
  return `${n} turn${n === 1 ? "" : "s"} left`;
}

module.exports = { turnsLeft, formatTurnsLeft };
