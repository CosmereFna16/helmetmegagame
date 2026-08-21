import { prisma } from "@lifeweb/db";
import { getGmSession } from "@/lib/discordGuild";

// navigator.sendBeacon target for MovePanel: releases a GM's lock when the tab
// closes, which a server action can't do because the page is already gone.
// Purely an optimisation — Action.lockExpiresAt is the real guarantee, so a
// failed beacon costs the next GM a short wait, never a stuck row.
export async function POST(request) {
  const { session, isGm } = await getGmSession();
  if (!session?.discordUserId || !isGm) return new Response(null, { status: 204 });

  const actionId = new URL(request.url).searchParams.get("actionId");
  if (!actionId) return new Response(null, { status: 204 });

  await prisma.action
    .updateMany({
      where: { id: actionId, lockedByDiscordUserId: session.discordUserId },
      data: { lockedByDiscordUserId: null, lockExpiresAt: null },
    })
    .catch(() => null);

  return new Response(null, { status: 204 });
}
