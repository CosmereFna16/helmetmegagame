"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@lifeweb/db";
import { auth } from "@/lib/auth";

// Unstarring in the web UI deletes the note outright — reacting ⭐ again in
// Discord doesn't toggle it off (the bot always strips the reaction right
// back off, see bot/src/events/messageReactionAdd.js), so this button is the
// only way to remove one. Scoped to the caller's own discordUserId so a
// player can never delete someone else's note.
export async function unstarNote(noteId) {
  const session = await auth();
  if (!session?.discordUserId) return;

  // `?? ""` is not cosmetic: Prisma strips an undefined field from a where
  // clause, so an omitted noteId would turn this into "delete every note this
  // player has ever written". A server action is a public endpoint.
  await prisma.note.deleteMany({ where: { id: noteId ?? "", discordUserId: session.discordUserId } });

  revalidatePath("/notes");
}
