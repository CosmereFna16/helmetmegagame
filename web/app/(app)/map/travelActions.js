"use server";

import { revalidatePath } from "next/cache";
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

  await syncCharacterLocationAccess(
    character.discordUserId,
    result.oldLocation?.id ?? null,
    target.id,
  ).catch(() => {});
  await syncCharacterNarrowcastAccess(character.id).catch(() => {});

  revalidatePath("/map");
  revalidatePath("/character");
  return { free: result.free, name: target.name };
}
