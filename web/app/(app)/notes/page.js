import { redirect } from "next/navigation";
import { prisma } from "@lifeweb/db";
import { auth } from "@/lib/auth";
import NotesList from "./NotesList";

// Notes are personal — a player's own list of messages they've starred in a
// Location channel (see bot/src/events/messageReactionAdd.js), never a
// shared/GM view of everyone's stars. Each signed-in user only ever sees
// notes keyed to their own discordUserId.
export default async function NotesPage() {
  const session = await auth();
  if (!session?.discordUserId) redirect("/");

  const notes = await prisma.note.findMany({
    where: { discordUserId: session.discordUserId },
    orderBy: { sentAt: "desc" },
    include: { zone: { select: { name: true } } },
  });

  const entries = notes.map((n) => ({
    id: n.id,
    characterName: n.characterName,
    zoneName: n.zone?.name ?? null,
    content: n.content,
    sentAt: n.sentAt.toISOString(),
  }));

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 p-6 sm:p-8">
      <h1 className="text-2xl font-bold">Notes</h1>
      <p className="text-sm" style={{ color: "var(--muted)" }}>
        Messages you&apos;ve starred with ⭐ in a location channel land here.
      </p>
      <NotesList notes={entries} />
    </div>
  );
}
