import { cache } from "react";
import { prisma } from "@lifeweb/db";
import { getGmSession } from "./discordGuild";
import { sortZones } from "./zones";

// The viewer's zone seats, if they hold any.
//
// This is the softest gate in the app and deliberately so: it decides which
// zones a GM's tables OPEN on, and nothing else. No query is scoped by it, no
// row is hidden. An Opposed Move crosses zones by nature, and a GM who cannot
// reach a row mid-turn is a worse failure than one who scrolled somewhere they
// did not need to. Every consumer is written so that an EMPTY LIST — the
// master, or an unassigned GM — means exactly today's behaviour.
//
// A GM may hold several seats (five GMs, six zones), so this is a list. Seats
// are always seat zones — Town, Fortress, Forest, Black Hills, Marshes,
// Underground — never one of the two cave levels; see the GmAssignment model
// comment.
//
// cache()-wrapped in the same style as getGmSession/getOpenTurn, so the four
// GM tables plus the nav cost one query per request rather than five.
export const getMyZones = cache(async () => {
  const { session, isGm } = await getGmSession();
  if (!session?.discordUserId || !isGm) return [];
  const rows = await prisma.gmAssignment.findMany({
    where: { discordUserId: session.discordUserId },
    include: { zone: { select: { id: true, name: true } } },
  });
  // Canonical zone order, not insertion order — a GM seated in Caves then Town
  // should read "Town, Caves" like everything else in the app does.
  return sortZones(rows.map((r) => r.zone).filter(Boolean));
});

// discordUserId -> the zones they are seated in. One query for the whole
// roster, for /gm/gamemasters. A GM with no seat is simply absent.
export async function listGmAssignments() {
  const rows = await prisma.gmAssignment.findMany({
    include: { zone: { select: { id: true, name: true } } },
  });
  const byUser = new Map();
  for (const row of rows) {
    if (!row.zone) continue;
    if (!byUser.has(row.discordUserId)) byUser.set(row.discordUserId, []);
    byUser.get(row.discordUserId).push(row.zone);
  }
  for (const [key, zones] of byUser) byUser.set(key, sortZones(zones));
  return byUser;
}
