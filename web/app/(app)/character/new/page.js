import { redirect } from "next/navigation";
import { prisma } from "@lifeweb/db";
import { auth } from "@/lib/auth";
import { createCharacter } from "./actions";

export default async function NewCharacterPage() {
  const session = await auth();
  if (!session?.discordUserId) redirect("/");

  const existing = await prisma.character.findFirst({
    where: { discordUserId: session.discordUserId, status: "ALIVE" },
  });
  if (existing) redirect("/character");

  return (
    <main className="mx-auto flex max-w-md flex-col gap-6 p-8">
      <h1 className="font-display text-3xl">Create Your Character</h1>
      <form action={createCharacter} className="panel flex flex-col gap-4 p-4">
        <label className="field">
          <span className="field-label">Name</span>
          <input name="name" required />
        </label>
        <label className="field">
          <span className="field-label">Role</span>
          <input name="roleTitle" placeholder="Farmer, Soldier, Pusher..." />
        </label>
        <button type="submit" className="btn self-start">
          Create
        </button>
      </form>
    </main>
  );
}
