import { cache } from "react";
import { prisma } from "@lifeweb/db";

// Multiple call sites (root layout, app shell, individual pages) all need
// the open turn on every request — cache() dedupes those into one query
// per request instead of 2-3. No TTL beyond that: turn state is GM-triggered
// and some actions rely on a fresh read right after revalidatePath, which a
// hand-rolled cross-request cache wouldn't respect.
export const getOpenTurn = cache(async () => {
  return prisma.turn.findFirst({ where: { status: "OPEN" } });
});

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
