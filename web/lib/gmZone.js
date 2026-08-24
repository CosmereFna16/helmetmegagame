import { cache } from "react";
import { prisma } from "@lifeweb/db";
import { getGmSession } from "./discordGuild";

// The viewer's zone seat, if they have one.
//
// This is the softest gate in the app and deliberately so: it decides which
// zone a GM's tables OPEN on, and nothing else. No query is scoped by it, no
// row is hidden. An Opposed Move crosses zones by nature, and a GM who cannot
// reach a row mid-turn is a worse failure than one who scrolled somewhere they
// did not need to. Every consumer is written so that `null` — the master, or
// an unassigned GM — means exactly today's behaviour.
//
// cache()-wrapped in the same style as getGmSession/getOpenTurn, so the four
// GM tables plus the nav cost one query per request rather than five.
export const getMyZone = cache(async () => {
  const { session, isGm } = await getGmSession();
  if (!session?.discordUserId || !isGm) return null;
  const row = await prisma.gmAssignment.findUnique({
    where: { discordUserId: session.discordUserId },
    include: { zone: { select: { id: true, name: true } } },
  });
  return row?.zone ?? null;
});

// discordUserId -> { id, name } for every GM who has a seat. One query for the
// whole roster, for /gm/gamemasters.
export async function listGmAssignments() {
  const rows = await prisma.gmAssignment.findMany({
    include: { zone: { select: { id: true, name: true } } },
  });
  return new Map(rows.map((r) => [r.discordUserId, r.zone ?? null]));
}
