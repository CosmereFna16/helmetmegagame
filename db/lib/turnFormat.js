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


// The single source for "how long does this tag last", covering all four
// states a chip can be in. `left` is turnsLeft() for a held CharacterTag (null
// for a bare catalog reference); `defaultDurationTurns` is the Tag's catalog
// duration.
//
// Returns { label, badge } or null when the tag simply doesn't expire:
//   held, counting down  -> { "2 turns left",            "2t"   }
//   held, final turn     -> { "Expires this turn",       "last" }
//   catalog reference    -> { "Lasts 1 turn once granted","1t"  }
//   neither              -> null
//
// "once granted" is load-bearing: it is the entire difference between a live
// countdown and a catalog fact, and its absence is why the same tag read two
// different ways depending on how it was granted.
function tagDuration(left, defaultDurationTurns) {
  if (left != null) {
    return left === 0
      ? { label: "Expires this turn", badge: "last" }
      : { label: `${left} turn${left === 1 ? "" : "s"} left`, badge: `${left}t` };
  }
  if (defaultDurationTurns) {
    const n = defaultDurationTurns;
    return {
      label: `Lasts ${n} turn${n === 1 ? "" : "s"} once granted`,
      badge: `${n}t`,
    };
  }
  return null;
}

// The absolute turn a tag granted right now should expire on, or null when it
// has no catalog duration (and so never expires). Every grant path must use
// this: resolveNeeds()'s sweep matches `expiresTurn <= turn.number`, so a row
// left null is permanent no matter what durationTurns says in the YAML.
// Before the game opens there is no turn to count from, so nothing expires.
// Moved down from web/lib/turnFormat.js (which re-exports it) so the
// staged-push pass can grant timed tags at turn end.
function expiryFor(tag, openTurn) {
  if (!tag?.defaultDurationTurns || !openTurn) return null;
  return openTurn.number + tag.defaultDurationTurns;
}

module.exports = { turnsLeft, formatTurnsLeft, tagDuration, expiryFor };
