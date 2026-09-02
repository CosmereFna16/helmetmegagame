// Turns-remaining formatting for a tag's expiry (web tooltip, Discord inspect
// embed). Hand-duplicated in web/lib/turnFormat.js so client components can
// import it dependency-free.

// Null when either side is unknown. Count is inclusive of the open turn
// (`expiresTurn` is the last live turn, since the sweep runs while that turn
// closes), so a tag expiring this turn has 1 left, not 0.
function turnsLeft(expiresTurn, currentTurn) {
  if (expiresTurn == null || currentTurn == null) return null;
  return Math.max(0, expiresTurn - currentTurn + 1);
}

function formatTurnsLeft(n) {
  if (n == null) return null;
  if (n <= 1) return "expires this turn";
  return `${n} turns left`;
}

// "How long does this tag last": `left` is turnsLeft() for a held
// CharacterTag (null for a bare catalog reference); `defaultDurationTurns` is
// the Tag's catalog duration. Returns { label, badge } or null if it never
// expires. "once granted" distinguishes a catalog fact from a live countdown.
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

// Last live turn, counted from the first live turn, inclusive. Null (never
// expires) for a duration of 0/null. The sweep matches `expiresTurn <=
// turn.number` while closing that turn, so the "-1" keeps a timed tag from
// getting N+1 turns. A pass granting at turn end must pass `turn.number + 1`.
function expiryFrom(firstLiveTurnNumber, durationTurns) {
  if (!durationTurns || firstLiveTurnNumber == null) return null;
  return firstLiveTurnNumber + durationTurns - 1;
}

// For reading a turn you already have (tooltips, chip badges). If granting
// from `findFirst({ status: "OPEN" })`, use grantExpiry.js#expiryForGrant
// instead — openTurn can be null mid-advance and this would silently grant
// a permanent tag.
function expiryFor(tag, openTurn) {
  if (!openTurn) return null;
  return expiryFrom(openTurn.number, tag?.defaultDurationTurns);
}

module.exports = { turnsLeft, formatTurnsLeft, tagDuration, expiryFrom, expiryFor };
