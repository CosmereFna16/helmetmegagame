"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { redirect } from "next/navigation";
import { prisma } from "@lifeweb/db";
import { performTravel } from "@lifeweb/db/lib/travel";
import { auth } from "@/lib/auth";
import { syncCharacterLocationAccess, syncCharacterNarrowcastAccess } from "@/lib/discordGuild";

// The web twin of the bot's ⚜ location picker. Both go through
// performTravel for the rules and the database writes; all this adds is the
// REST half of the Discord work the bot does over the gateway.
export async function travelTo(locationId) {
  const session = await auth();
  if (!session?.discordUserId) redirect("/");

  // From the session, never from the client: a server action is a public
  // endpoint, so a posted character id would let anyone walk someone else
  // across the map. Same posture as character/equipActions.js.
  const character = await prisma.character.findFirst({
    where: { discordUserId: session.discordUserId, status: "ALIVE" },
    select: { id: true, locationId: true, zoneId: true, discordUserId: true },
  });
  if (!character) return { error: "No living character." };

  const target = await prisma.location.findUnique({ where: { id: locationId } });
  if (!target) return { error: "That location no longer exists." };
  if (target.id === character.locationId) return { error: "You're already there." };

  const result = await performTravel(prisma, character, target);
  if (!result.ok) return { error: result.reason };

  // Deferred, not awaited in the request. These are up to ten sequential
  // Discord permission-overwrite calls (category plus three channels for the
  // old Location and again for the new, plus the two narrowcast channels), and
  // per-channel overwrite endpoints are among the tighter buckets. Travel is a
  // turn-open activity, so at roster scale that is dozens of requests each
  // pinned open for seconds — and a pending server action blocks App Router
  // client-side navigation, which is the lockup ARCHITECTURE.md §4 exists
  // about. The database write has already committed; the Discord work only
  // decides which channels they can see, and arriving a second late is fine.
  //
  // Same posture as forceAdvanceTurn in gm/dev/actions.js.
  after(async () => {
    await syncCharacterLocationAccess(
      character.discordUserId,
      result.oldLocation?.id ?? null,
      target.id,
    ).catch((err) => console.error("Travel: location access sync failed:", err));
    await syncCharacterNarrowcastAccess(character.id).catch((err) =>
      console.error("Travel: narrowcast access sync failed:", err),
    );
  });

  revalidatePath("/map");
  revalidatePath("/character");
  return { free: result.free, name: target.name };
}
