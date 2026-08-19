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

export function themeForPhase(phase) {
  return phase === "DUSK" ? "dusk" : "dawn";
}

// "Turn 1, Dusk" — the raw sequential turn number (not the day/2 grouping
// describeTurn() computes), used in tables that list individual actions.
export function formatTurnLabel(turnNumber, phase) {
  if (turnNumber == null) return "-";
  if (!phase) return `Turn ${turnNumber}`;
  const phaseLabel = phase.charAt(0) + phase.slice(1).toLowerCase();
  return `Turn ${turnNumber}, ${phaseLabel}`;
}
