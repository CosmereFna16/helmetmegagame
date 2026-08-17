// Base distribution used only when there's no previous turn's weather to
// build on (the very first turn the game ever plays) — every turn after
// that is driven by WEATHER_TRANSITIONS below. Bias toward CLEAR as the
// game's baseline condition.
const WEATHER_WEIGHTS = { CLEAR: 45, FOG: 25, RAIN: 17, STORM: 10, MIGRATION: 3 }; // sums to 100

// Weather rolls every turn (twice a day — see advanceTurn() in
// db/index.js), as a Markov transition off the *previous turn's* weather,
// split into a DAWN table and a DUSK table so the roll also depends on
// which phase is being entered. Every row in both tables sums to 100.
//
// The self-transition (diagonal) weight is what creates a streak: CLEAR
// and RAIN are "spell" states that can run several turns in a row (a clear
// spell; three turns of rain). STORM's diagonal is deliberately the
// highest of any state in either table — every *other* state only enters
// STORM rarely (kept low on purpose, so it stays a dramatic, occasional
// event rather than the norm), but once one kicks off it can rage for many
// turns straight, the same in the morning as the evening — so a full
// multi-day storm is rare but genuinely possible, not diluted away by
// starting over each turn. MIGRATION never repeats turn-to-turn (a one-off
// omen, not a weather regime).
//
// FOG is the one state that's genuinely phase-dependent, mirroring real
// mornings-fog-burns-off-by-evening behavior: the DAWN table both enters
// and holds FOG far more readily (from every other state, and with a much
// higher self-transition) than the DUSK table, where FOG mostly resolves
// back to CLEAR instead of persisting.
const WEATHER_TRANSITIONS = {
  DAWN: {
    CLEAR: { CLEAR: 47, FOG: 35, RAIN: 13, STORM: 2, MIGRATION: 3 },
    FOG: { CLEAR: 32, FOG: 45, RAIN: 18, STORM: 3, MIGRATION: 2 },
    RAIN: { CLEAR: 20, FOG: 22, RAIN: 48, STORM: 7, MIGRATION: 3 },
    STORM: { CLEAR: 10, FOG: 8, RAIN: 12, STORM: 65, MIGRATION: 5 },
    MIGRATION: { CLEAR: 36, FOG: 40, RAIN: 20, STORM: 4, MIGRATION: 0 },
  },
  DUSK: {
    CLEAR: { CLEAR: 65, FOG: 10, RAIN: 17, STORM: 3, MIGRATION: 5 },
    FOG: { CLEAR: 58, FOG: 15, RAIN: 22, STORM: 3, MIGRATION: 2 },
    RAIN: { CLEAR: 25, FOG: 8, RAIN: 55, STORM: 9, MIGRATION: 3 },
    STORM: { CLEAR: 10, FOG: 4, RAIN: 16, STORM: 65, MIGRATION: 5 },
    MIGRATION: { CLEAR: 53, FOG: 15, RAIN: 28, STORM: 4, MIGRATION: 0 },
  },
};

const WEATHER_MESSAGES = {
  CLEAR: "It's clear.",
  FOG: "It's foggy. Visibility is impaired.",
  RAIN: "It's raining.",
  STORM: "It's storming. Thunder shakes the mountains.",
  MIGRATION: "An enormous flock of black birds block the sky. Everyone knows this is a bad omen.",
};

function rollFromWeights(weights) {
  const total = Object.values(weights).reduce((sum, w) => sum + w, 0);
  let roll = Math.random() * total;
  for (const [outcome, weight] of Object.entries(weights)) {
    if (roll < weight) return outcome;
    roll -= weight;
  }
  return "CLEAR";
}

// Rolls this turn's weather. Pass the previous turn's weather and the
// phase being entered ("DAWN"/"DUSK") to walk the matching
// WEATHER_TRANSITIONS row (the normal case); omit previousWeather (or pass
// an unrecognized value) to fall back to the flat WEATHER_WEIGHTS
// baseline, which only happens on the very first turn the game ever plays.
function rollWeather(previousWeather, phase) {
  const table = WEATHER_TRANSITIONS[phase] ?? WEATHER_TRANSITIONS.DAWN;
  const weights = table[previousWeather] ?? WEATHER_WEIGHTS;
  return rollFromWeights(weights);
}

// Converts a Chicago (America/Chicago) wall-clock time into the UTC Date
// it actually represents, accounting for CST/CDT — the standard
// guess-then-correct trick, since Node has no built-in "construct a Date
// from a wall time in an arbitrary IANA zone" primitive.
function chicagoWallTimeToUTC(year, month, day, hour) {
  const guess = new Date(Date.UTC(year, month - 1, day, hour, 0, 0));
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(guess);
  const map = {};
  for (const p of parts) map[p.type] = p.value;
  const asIfChicago = new Date(
    Date.UTC(Number(map.year), Number(map.month) - 1, Number(map.day), map.hour === "24" ? 0 : Number(map.hour), Number(map.minute), Number(map.second))
  );
  return new Date(guess.getTime() + (guess.getTime() - asIfChicago.getTime()));
}

// Turns advance at 10:00 and 22:00 America/Chicago (bot/src/events/ready.js's
// cron schedule) — find the next of those two boundaries after `now`, so the
// turn announcement can tell players when the current turn closes.
function nextTurnEndTime(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
  }).formatToParts(now);
  const map = {};
  for (const p of parts) map[p.type] = p.value;
  const year = Number(map.year);
  const month = Number(map.month);
  const day = Number(map.day);
  const hour = map.hour === "24" ? 0 : Number(map.hour);

  if (hour < 10) return chicagoWallTimeToUTC(year, month, day, 10);
  if (hour < 22) return chicagoWallTimeToUTC(year, month, day, 22);
  const tomorrow = new Date(Date.UTC(year, month - 1, day + 1));
  return chicagoWallTimeToUTC(tomorrow.getUTCFullYear(), tomorrow.getUTCMonth() + 1, tomorrow.getUTCDate(), 10);
}

// Shared by the bot's cron-triggered turn advance and the GM dashboard's
// manual "End turn" action so the announcement text (and the ping/weather
// logic behind it) only exists in one place instead of being duplicated
// per transport (Discord.js channel.send vs. REST postMessage).
function buildTurnAnnouncement(turn, note) {
  const day = Math.ceil(turn.number / 2);
  const phaseLabel = turn.phase === "DAWN" ? "Dawn" : "Dusk";
  const pingRoleId = process.env.DISCORD_TURN_PING_ROLE_ID;
  const ping = pingRoleId ? ` <@&${pingRoleId}>` : "";
  const endUnix = Math.floor(nextTurnEndTime().getTime() / 1000);
  const header = `» Day ${day} | ${phaseLabel}. ${WEATHER_MESSAGES[turn.weather]}${ping}\nThis turn ends <t:${endUnix}:t>, <t:${endUnix}:R>.`;
  return note ? `${header}\n\n${note}` : header;
}

module.exports = { WEATHER_WEIGHTS, WEATHER_TRANSITIONS, WEATHER_MESSAGES, rollWeather, buildTurnAnnouncement, nextTurnEndTime };
