import { prisma } from "@lifeweb/db";

export async function getOpenTurn() {
  return prisma.turn.findFirst({ where: { status: "OPEN" } });
}

export function describeTurn(turn) {
  if (!turn) return { day: null, phase: null, label: "NO TURN OPEN" };
  const day = Math.ceil(turn.number / 2);
  return { day, phase: turn.phase, label: `DAY ${day} · ${turn.phase}` };
}

export function themeForPhase(phase) {
  return phase === "DUSK" ? "dusk" : "dawn";
}
