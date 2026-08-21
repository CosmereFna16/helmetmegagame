// Pure turn-formatting helpers with no database dependency, kept separate
// from turn.js's getOpenTurn() so client components can import these
// without dragging the @lifeweb/db (Prisma) barrel into the browser bundle.

const WEATHER_LABELS = {
  CLEAR: "Clear",
  FOG: "Fog",
  RAIN: "Rain",
  STORM: "Storm",
  MIGRATION: "Migration",
};

export function describeTurn(turn) {
  if (!turn) return { day: null, phase: null, weather: null, label: "NO TURN OPEN" };
  const day = Math.ceil(turn.number / 2);
  const weatherLabel = WEATHER_LABELS[turn.weather] ?? turn.weather;
  return { day, phase: turn.phase, weather: turn.weather, label: `DAY ${day} · ${turn.phase} · ${weatherLabel}` };
}

// The themes globals.css defines. Both phase themes are underground darks;
// "limestone" is the light-theme backup and is deliberately NOT reachable from
// a phase — only via the LIFEWEB_THEME override below.
export const THEMES = ["dusk", "dawn", "limestone"];

export function themeForPhase(phase) {
  return phase === "DUSK" ? "dusk" : "dawn";
}

// Lets a whole environment be pinned to one theme regardless of the turn, so
// limestone can actually be looked at and compared side by side — without it
// there is no way to reach a theme that no phase maps to. Unset (the normal
// case) or unrecognised falls straight through to the phase theme, so a typo
// degrades to correct behaviour rather than an unstyled page.
export function resolveTheme(phase, override) {
  return THEMES.includes(override) ? override : themeForPhase(phase);
}

// "Turn 1, Dusk" — the raw sequential turn number (not the day/2 grouping
// describeTurn() computes), used in tables that list individual actions.
export function formatTurnLabel(turnNumber, phase) {
  if (turnNumber == null) return "-";
  if (!phase) return `Turn ${turnNumber}`;
  const phaseLabel = phase.charAt(0) + phase.slice(1).toLowerCase();
  return `Turn ${turnNumber}, ${phaseLabel}`;
}

// How many turns a timed tag has left. `CharacterTag.expiresTurn` is an
// absolute turn number, never a countdown, so the answer is just the gap to
// the open turn — see the sweep in db/index.js#resolveNeeds. Null whenever
// either side is missing, which is the common case: most tags never expire.
//
// Shared so the Mood countdown on StatusPanel and the countdown on every tag
// chip cannot disagree, since they read the same column.
export function turnsLeft(expiresTurn, currentTurn) {
  if (expiresTurn == null || currentTurn == null) return null;
  return Math.max(0, expiresTurn - currentTurn);
}

// "2 turns left" / "1 turn left" / "expires this turn".
export function formatTurnsLeft(n) {
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
export function tagDuration(left, defaultDurationTurns) {
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
export function expiryFor(tag, openTurn) {
  if (!tag?.defaultDurationTurns || !openTurn) return null;
  return openTurn.number + tag.defaultDurationTurns;
}
