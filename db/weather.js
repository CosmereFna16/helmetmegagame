// Base distribution used only when there's no previous turn's weather to
// build on (the very first turn the game ever plays) — every turn after
// that is driven by WEATHER_TRANSITIONS below. Bias toward CLEAR as the
// game's baseline condition.
const WEATHER_WEIGHTS = { CLEAR: 48, FOG: 25, RAIN: 17, STORM: 10 }; // sums to 100

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
// starting over each turn.
//
// FOG is the one state that's genuinely phase-dependent, mirroring real
// mornings-fog-burns-off-by-evening behavior: the DAWN table both enters
// and holds FOG far more readily (from every other state, and with a much
// higher self-transition) than the DUSK table, where FOG mostly resolves
// back to CLEAR instead of persisting.
const WEATHER_TRANSITIONS = {
  DAWN: {
    CLEAR: { CLEAR: 50, FOG: 35, RAIN: 13, STORM: 2 },
    FOG: { CLEAR: 34, FOG: 45, RAIN: 18, STORM: 3 },
    RAIN: { CLEAR: 23, FOG: 22, RAIN: 48, STORM: 7 },
    STORM: { CLEAR: 15, FOG: 8, RAIN: 12, STORM: 65 },
  },
  DUSK: {
    CLEAR: { CLEAR: 70, FOG: 10, RAIN: 17, STORM: 3 },
    FOG: { CLEAR: 60, FOG: 15, RAIN: 22, STORM: 3 },
    RAIN: { CLEAR: 28, FOG: 8, RAIN: 55, STORM: 9 },
    STORM: { CLEAR: 15, FOG: 4, RAIN: 16, STORM: 65 },
  },
};

const WEATHER_MESSAGES = {
  CLEAR: "It's clear.",
  FOG: "It's foggy. Visibility is impaired.",
  RAIN: "It's raining.",
  STORM: "It's storming. Thunder shakes the mountains.",
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

// Turns advance at 0:00 and 12:00 America/Chicago (bot/src/events/ready.js's
// cron schedule), strictly alternating DAWN/DUSK — a DAWN turn always opens
// at noon and runs until midnight the same day, a DUSK turn always opens at
// midnight and runs until noon the same day. The announcement renders this as a
// Discord <t:EPOCH:t>/<t:EPOCH:R> tag (per-viewer local time + relative
// countdown), which needs an actual Unix epoch rather than a text label —
// these two helpers do a DST-safe local-time-in-a-zone -> UTC conversion
// using only the built-in Intl API (no date library needed for one zone).
function getTimeZoneOffsetMs(utcMs, timeZone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  })
    .formatToParts(new Date(utcMs))
    .reduce((acc, p) => {
      acc[p.type] = p.value;
      return acc;
    }, {});
  const asUTC = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return asUTC - utcMs;
}

function zonedTimeToUtc(y, m, d, h, min, s, timeZone) {
  let utc = Date.UTC(y, m - 1, d, h, min, s);
  for (let i = 0; i < 2; i++) {
    utc = Date.UTC(y, m - 1, d, h, min, s) - getTimeZoneOffsetMs(utc, timeZone);
  }
  return utc;
}

// Given the phase of the turn that just opened, returns the epoch seconds
// (for a Discord <t:> tag) of the boundary when it closes: DAWN closes at
// midnight the same Chicago day it opened (i.e. hour 0 the next calendar
// day), DUSK closes at noon the same Chicago day it opened.
function turnEndEpochSeconds(phase) {
  const timeZone = "America/Chicago";
  const nowParts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
    .formatToParts(new Date())
    .reduce((acc, p) => {
      acc[p.type] = p.value;
      return acc;
    }, {});
  const targetHour = phase === "DAWN" ? 0 : 12;
  const dayOffset = phase === "DAWN" ? 1 : 0;
  const utcMs = zonedTimeToUtc(
    Number(nowParts.year),
    Number(nowParts.month),
    Number(nowParts.day) + dayOffset,
    targetHour,
    0,
    0,
    timeZone,
  );
  return Math.round(utcMs / 1000);
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
  const endEpoch = turnEndEpochSeconds(turn.phase);
  const header = `» Day ${day} | ${phaseLabel}. ${WEATHER_MESSAGES[turn.weather]}${ping}\nThis turn ends at <t:${endEpoch}:t>, or <t:${endEpoch}:R>.`;
  return note ? `${header}\n\n${note}` : header;
}

module.exports = { WEATHER_WEIGHTS, WEATHER_TRANSITIONS, WEATHER_MESSAGES, rollWeather, buildTurnAnnouncement, turnEndEpochSeconds };
