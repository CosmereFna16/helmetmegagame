"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@lifeweb/db";
import { auth } from "@/lib/auth";

// Equipping is instant and writes no Request and no AuditLog. That is
// deliberate: it costs nothing, the player can undo it themselves in one tap,
// and at 100+ players a row per toggle would drown /gm/audit and the Requests
// tab in noise. Contrast TRANSFER_RESOURCES, which moves something real and so
// has to be reviewable — see docs/systemdocs/REQUESTS.md.
export async function toggleEquip(characterTagId) {
  const session = await auth();
  if (!session?.discordUserId) redirect("/");

  // The character comes from the session, never from the client: a server
  // action is a public endpoint, so an id posted directly would otherwise let
  // anyone equip things on someone else's sheet.
  const character = await prisma.character.findFirst({
    where: { discordUserId: session.discordUserId, status: "ALIVE" },
    select: { id: true },
  });
  if (!character) return { error: "No living character." };

  const held = await prisma.characterTag.findFirst({
    where: { id: characterTagId ?? "", characterId: character.id },
    select: { id: true, equipped: true, tag: { select: { equippable: true, name: true } } },
  });
  if (!held) return { error: "You aren't holding that." };
  if (!held.tag.equippable) return { error: `${held.tag.name} isn't something you can equip.` };

  if (held.equipped) {
    await prisma.characterTag.update({ where: { id: held.id }, data: { equipped: false } });
    revalidatePath("/character");
    return { equipped: false };
  }

  // Counting inside the transaction is NOT enough on its own: Prisma runs at
  // READ COMMITTED, so two tabs (or one impatient double-tap) both read the
  // same count, both see a free slot, and both write — which is exactly what
  // happens without the lock below. Taking a row lock on the Character first
  // serializes every equip for this one character, so the second attempt reads
  // the first's committed count. Contention is per-character, i.e. only ever
  // between one player's own clients.
  try {
    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Character" WHERE id = ${character.id} FOR UPDATE`;
      const config = await tx.gameConfig.findUnique({ where: { id: 1 }, select: { equipSlots: true } });
      const slots = config?.equipSlots ?? 6;
      const inUse = await tx.characterTag.count({ where: { characterId: character.id, equipped: true } });
      if (inUse >= slots) throw new Error("NO_SLOTS");
      await tx.characterTag.update({ where: { id: held.id }, data: { equipped: true } });
    });
  } catch (err) {
    if (err.message === "NO_SLOTS") return { error: "You have no free equipment slots." };
    throw err;
  }

  revalidatePath("/character");
  return { equipped: true };
}
