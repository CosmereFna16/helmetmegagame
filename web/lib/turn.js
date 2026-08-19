import { cache } from "react";
import { prisma } from "@lifeweb/db";

// Multiple call sites (root layout, app shell, individual pages) all need
// the open turn on every request — cache() dedupes those into one query
// per request instead of 2-3. No TTL beyond that: turn state is GM-triggered
// and some actions rely on a fresh read right after revalidatePath, which a
// hand-rolled cross-request cache wouldn't respect.
//
// Pure formatting helpers (describeTurn, themeForPhase, formatTurnLabel)
// live in turnFormat.js, not here — this file imports @lifeweb/db (Prisma),
// and any client component importing from this file would drag that whole
// barrel (and its node:fs-touching dependencies) into the browser bundle.
export const getOpenTurn = cache(async () => {
  return prisma.turn.findFirst({ where: { status: "OPEN" } });
});
