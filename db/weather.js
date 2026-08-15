const WEATHER_WEIGHTS = { CLEAR: 40, FOG: 35, RAIN: 15, STORM: 9, MIGRATION: 1 }; // sums to 100

const WEATHER_MESSAGES = {
  CLEAR: "It's clear.",
  FOG: "It's foggy. Visibility is impaired.",
  RAIN: "It's raining.",
  STORM: "It's storming. Thunder shakes the mountains.",
  MIGRATION: "An enormous flock of black birds block the sky. Everyone knows this is a bad omen.",
};

function rollWeather() {
  const total = Object.values(WEATHER_WEIGHTS).reduce((sum, w) => sum + w, 0);
  let roll = Math.random() * total;
  for (const [weather, weight] of Object.entries(WEATHER_WEIGHTS)) {
    if (roll < weight) return weather;
    roll -= weight;
  }
  return "CLEAR";
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

module.exports = { WEATHER_WEIGHTS, WEATHER_MESSAGES, rollWeather, buildTurnAnnouncement };
