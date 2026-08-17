// Base distribution used only when there's no prior day's weather to build
// on (the very first turn the game ever plays) — every turn after that is
// driven by WEATHER_TRANSITIONS below, which is what actually produces
// multi-day streaks (a clear spell, three days of rain running) instead of
// every day rolling independently of the last. Bias toward CLEAR as the
// game's baseline condition.
const WEATHER_WEIGHTS = { CLEAR: 45, FOG: 25, RAIN: 17, STORM: 10, MIGRATION: 3 }; // sums to 100

// Weather changes once per in-game day, on the DAWN turn (see advanceTurn()
// in db/index.js, which carries that same value forward unchanged to the
// DUSK turn later that day — a day reads as one coherent condition rather
// than flipping mid-day). Each row is a Markov transition keyed on
// *yesterday's* weather, and every row sums to 100.
//
// The self-transition (diagonal) weight is what creates a streak: CLEAR and
// RAIN are the two "spell" states with the highest chance of repeating
// several days running (a clear spell; three days of rain). STORM is
// intense but short — it burns down fast toward RAIN or CLEAR rather than
// stacking storm-on-storm. MIGRATION never repeats two days in a row (a
// one-day omen, not a weather regime) and is rare to enter from anywhere.
// Every row is also weighted so CLEAR is the state the weather tends to
// drift back toward, on top of whatever streak is currently running.
const WEATHER_TRANSITIONS = {
  CLEAR: { CLEAR: 60, FOG: 20, RAIN: 12, STORM: 5, MIGRATION: 3 },
  FOG: { CLEAR: 40, FOG: 35, RAIN: 18, STORM: 5, MIGRATION: 2 },
  RAIN: { CLEAR: 25, FOG: 15, RAIN: 45, STORM: 12, MIGRATION: 3 },
  STORM: { CLEAR: 20, FOG: 10, RAIN: 40, STORM: 25, MIGRATION: 5 },
  MIGRATION: { CLEAR: 45, FOG: 30, RAIN: 20, STORM: 5, MIGRATION: 0 },
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

// Rolls the next day's weather. Pass yesterday's weather to walk the
// WEATHER_TRANSITIONS row for it (the normal case); omit it (or pass an
// unrecognized value) to fall back to the flat WEATHER_WEIGHTS baseline,
// which only happens on the very first turn the game ever plays.
function rollWeather(previousWeather) {
  const weights = WEATHER_TRANSITIONS[previousWeather] ?? WEATHER_WEIGHTS;
  return rollFromWeights(weights);
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
  const header = `» Day ${day} | ${phaseLabel}. ${WEATHER_MESSAGES[turn.weather]}${ping}`;
  return note ? `${header}\n\n${note}` : header;
}

module.exports = { WEATHER_WEIGHTS, WEATHER_TRANSITIONS, WEATHER_MESSAGES, rollWeather, buildTurnAnnouncement };
