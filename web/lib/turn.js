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

export function describeTurn(turn) {
  if (!turn) return { day: null, phase: null, label: "NO TURN OPEN" };
  const day = Math.ceil(turn.number / 2);
  return { day, phase: turn.phase, label: `DAY ${day} · ${turn.phase}` };
}

export function themeForPhase(phase) {
  return phase === "DUSK" ? "dusk" : "dawn";
}
