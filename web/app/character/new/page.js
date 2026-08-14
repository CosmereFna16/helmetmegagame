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
      <h1 className="text-2xl font-bold">Create Your Character</h1>
      <form action={createCharacter} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1">
          <span>Name</span>
          <input
            name="name"
            required
            className="rounded border border-white/30 bg-transparent px-3 py-2"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span>Role</span>
          <input
            name="roleTitle"
            placeholder="Farmer, Soldier, Pusher..."
            className="rounded border border-white/30 bg-transparent px-3 py-2"
          />
        </label>
        <button type="submit" className="menu-item self-start">
          &gt; Create
        </button>
      </form>
    </main>
  );
}
