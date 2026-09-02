// Turns-remaining formatting, for anywhere a tag's expiry is shown beside it
// (web tooltip, Discord inspect embed). Lives here rather than in bot/ since
// it pairs with formatTagRequirement.js in the same embed line. Deliberately
// duplicated by hand with web/lib/turnFormat.js's copies, same convention as
// formatTagRequirement and buildNickname — keeping the web copy
// dependency-free is what lets client components import it.

// Null when either side is unknown, so a tag that never expires (or a caller
// with no open turn) renders no expiry line at all rather than "0".
//
// The count is INCLUSIVE of the open turn: `expiresTurn` is the last turn the
// tag is live for, because the sweep runs while that turn CLOSES. So a tag
// expiring on the open turn has one turn left, not zero — counting exclusively
// would give a two-turn tag three states ("2 left, 1 left, last turn").
function turnsLeft(expiresTurn, currentTurn) {
  if (expiresTurn == null || currentTurn == null) return null;
  return Math.max(0, expiresTurn - currentTurn + 1);
}

// "2 turns left" / "expires this turn". A 1 means this turn is the last one,
// so it takes the wording rather than the number; 0 only happens to a row the
// sweep has not reached yet, and reads the same.
function formatTurnsLeft(n) {
  if (n == null) return null;
  if (n <= 1) return "expires this turn";
  return `${n} turns left`;
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
// turnsLeft() counts the open turn, so the final turn arrives here as 1 and
// takes the wording instead of a bare "1t" — the whole sequence for a 2-turn
// tag is now "2 turns left" then "Expires this turn", one state per turn.
//
// "once granted" is load-bearing: it is the entire difference between a live
// countdown and a catalog fact, and its absence is why the same tag read two
// different ways depending on how it was granted.
function tagDuration(left, defaultDurationTurns) {
  if (left != null) {
    return left <= 1
      ? { label: "Expires this turn", badge: "last" }
      : { label: `${left} turns left`, badge: `${left}t` };
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

// The last turn a tag is live for, counted from the FIRST turn it is live for.
// `N turns` means N turns, inclusive of that first one — so a 1-turn tag
// granted mid-turn runs out when this turn closes, and a 2-turn tag survives
// one more. Null for a duration of 0/null (the tag never expires) so callers
// can hand the result straight to `expiresTurn`.
//
// The "-1" matters: the sweep matches `expiresTurn <= turn.number` while
// CLOSING that turn, so the expiry turn is itself a turn the tag is live for.
// Adding the raw duration would give every timed tag N+1 turns on the sheet.
//
// A pass that grants at turn end must pass `turn.number + 1` — the tag's first
// live turn is the one about to open, not the one being swept. db/index.js's
// stack reroll, hungerPass, tagExpiryPass, moveEffects and stagedPush all do.
function expiryFrom(firstLiveTurnNumber, durationTurns) {
  if (!durationTurns || firstLiveTurnNumber == null) return null;
  return firstLiveTurnNumber + durationTurns - 1;
}

// THE DISPLAY/GRANT SPLIT. This one is for reading a turn you already have —
// tooltips, chip badges, and any grant path that is certain of its turn. If you
// are GRANTING and the turn came from `findFirst({ status: "OPEN" })`, use
// db/lib/grantExpiry.js#expiryForGrant instead: openTurn is null for the whole
// of a turn advance (and for hours after a wedged one), and the null this
// returns in that case lands a permanent tag with nothing logged.
//
// The same thing for the common case: a tag granted during the open turn, so
// the open turn is its first live one. Every mid-turn grant path must use it:
// resolveNeeds()'s sweep matches on expiresTurn, so a row left null is
// permanent no matter what durationTurns says in the YAML. Before the game
// opens there is no turn to count from, so nothing expires.
function expiryFor(tag, openTurn) {
  if (!openTurn) return null;
  return expiryFrom(openTurn.number, tag?.defaultDurationTurns);
}

module.exports = { turnsLeft, formatTurnsLeft, tagDuration, expiryFrom, expiryFor };
