"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { redirect } from "next/navigation";
import { prisma } from "@lifeweb/db";
import { performTravel } from "@lifeweb/db/lib/travel";
import { applyPendingInvites } from "@lifeweb/db/lib/threadInvites";
import { auth } from "@/lib/auth";
import { syncCharacterZoneRole, syncCharacterNarrowcastAccess } from "@/lib/discordGuild";

// The web twin of the bot's zone picker (bot/src/lib/zoneTravel.js#performMove).
// Both go through performTravel for the rules and the database writes; all
// this adds is the REST half of the Discord work the bot does over the gateway.
export async function travelTo(zoneId) {
  const session = await auth();
  if (!session?.discordUserId) redirect("/");

  // From the session, never from the client: a server action is a public
  // endpoint, so a posted character id would let anyone walk someone else
  // across the map. Same posture as character/equipActions.js.
  const character = await prisma.character.findFirst({
    where: { discordUserId: session.discordUserId, status: "ALIVE" },
    select: { id: true, zoneId: true, discordUserId: true },
  });
  if (!character) return { error: "No living character." };

  const target = await prisma.zone.findUnique({ where: { id: zoneId } });
  if (!target) return { error: "That zone no longer exists." };

  // Everything else — the group-row check, adjacency, "you're already there",
  // the open turn and the already-acted race — is performTravel's, so the two
  // faces can never disagree about what a legal hop is.
  const result = await performTravel(prisma, character, target);
  if (!result.ok) return { error: result.reason };

  // Deferred, not awaited in the request. These are a handful of sequential
  // Discord calls — the zone role swap, the two narrowcast channels, and one
  // thread-member add per standing invite — and per-channel overwrite
  // endpoints are among the tighter buckets. Travel is a turn-open activity,
  // so at roster scale that is dozens of requests each pinned open for
  // seconds — and a pending server action blocks App Router client-side
  // navigation, which is the lockup ARCHITECTURE.md §4 exists about. The
  // database write has already committed; the Discord work only decides which
  // channels they can see, and arriving a second late is fine.
  //
  // Same posture as forceAdvanceTurn in gm/dev/actions.js.
  after(async () => {
    await syncCharacterZoneRole(
      character.discordUserId,
      result.oldZone?.id ?? null,
      target.id,
    ).catch((err) => console.error("Travel: zone role sync failed:", err));
    await syncCharacterNarrowcastAccess(character.id).catch((err) =>
      console.error("Travel: narrowcast access sync failed:", err),
    );
    // The second half of the /add contract: standing invites for private
    // threads in this zone land the moment their guest arrives.
    await applyPendingInvites(prisma, { ...character, zoneId: target.id }).catch((err) =>
      console.error("Travel: pending thread invites failed:", err),
    );
  });

  revalidatePath("/map");
  revalidatePath("/character");
  // A first placement is the only free arrival — every real hop spends the
  // Move (see performTravel).
  return { free: !result.oldZone, name: target.name };
}
