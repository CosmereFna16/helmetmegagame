import { getGmSession } from "@/lib/discordGuild";
import { getInboxDelta } from "@/lib/inboxDelta";
import { deployVersion } from "@/lib/deployVersion";

// The player desk's live feed (LiveInboxPoller.js): "what changed since
// `since`". A plain GET rather than a server action on purpose — a server
// action goes through the router's serial action queue, so a poll in flight
// would hold up the GM's own reply send, and a POST can't be aborted or
// timed out. A fetch here never touches the router, so it can never trip the
// build-mismatch full reload the desks guard against.
//
// `version` rides along so the client can latch stale in ~3s after a deploy
// instead of waiting for the 30s poll's own check.
export const dynamic = "force-dynamic";

export async function GET(request) {
  const { session, isGm } = await getGmSession();
  if (!session?.discordUserId || !isGm) return new Response(null, { status: 204 });

  const url = new URL(request.url);
  const sinceMs = Number(url.searchParams.get("since")) || null;
  // Only ever a lookup key — nothing is trusted about it beyond that.
  const open = url.searchParams.get("open") || null;
  const full = url.searchParams.get("full") === "1";

  const delta = await getInboxDelta({
    gmDiscordUserId: session.discordUserId,
    sinceMs,
    openDiscordUserId: open,
    full,
  });

  return Response.json(
    { version: deployVersion(), ...delta },
    { headers: { "cache-control": "no-store" } },
  );
}
