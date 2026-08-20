// Base distribution used only when there's no previous turn's weather to
// build on (the very first turn the game ever plays) — every turn after
// that is driven by WEATHER_TRANSITIONS below. Bias toward CLEAR as the
// game's baseline condition.
const WEATHER_WEIGHTS = { CLEAR: 47, FOG: 25, RAIN: 17, STORM: 10, MIGRATION: 1 }; // sums to 100

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
    CLEAR: { CLEAR: 49, FOG: 35, RAIN: 13, STORM: 2, MIGRATION: 1 },
    FOG: { CLEAR: 33, FOG: 45, RAIN: 18, STORM: 3, MIGRATION: 1 },
    RAIN: { CLEAR: 22, FOG: 22, RAIN: 48, STORM: 7, MIGRATION: 1 },
    STORM: { CLEAR: 13, FOG: 8, RAIN: 12, STORM: 65, MIGRATION: 2 },
    MIGRATION: { CLEAR: 36, FOG: 40, RAIN: 20, STORM: 4, MIGRATION: 0 },
  },
  DUSK: {
    CLEAR: { CLEAR: 68, FOG: 10, RAIN: 17, STORM: 3, MIGRATION: 2 },
    FOG: { CLEAR: 59, FOG: 15, RAIN: 22, STORM: 3, MIGRATION: 1 },
    RAIN: { CLEAR: 27, FOG: 8, RAIN: 55, STORM: 9, MIGRATION: 1 },
    STORM: { CLEAR: 13, FOG: 4, RAIN: 16, STORM: 65, MIGRATION: 2 },
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

// Turns advance at 4:00 and 16:00 America/Chicago (bot/src/events/ready.js's
// cron schedule), strictly alternating DAWN/DUSK — a DAWN turn always opens
// at 4 AM and runs until 4 PM the same day, a DUSK turn always opens at
// 4 PM and runs until 4 AM the next day. So the label for when the
// currently-open turn ends is just the other boundary from its own phase;
// no clock math needed. Plain text rather than a Discord <t:> timestamp
// tag, since the boundary is a fixed wall-clock time, not something worth
// rendering as a per-viewer relative countdown.
function turnEndLabel(phase) {
  return phase === "DAWN" ? "4 PM" : "4 AM";
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
  const header = `» Day ${day} | ${phaseLabel}. ${WEATHER_MESSAGES[turn.weather]}${ping}\nThis turn ends at ${turnEndLabel(turn.phase)} CST.`;
  return note ? `${header}\n\n${note}` : header;
}

module.exports = { WEATHER_WEIGHTS, WEATHER_TRANSITIONS, WEATHER_MESSAGES, rollWeather, buildTurnAnnouncement, turnEndLabel };
