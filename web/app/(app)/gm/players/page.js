import { redirect } from "next/navigation";
import { prisma } from "@lifeweb/db";
import { getGmSession } from "@/lib/discordGuild";
import PlayersTable from "./PlayersTable";

export default async function PlayersPage() {
  const { session, isGm: gm } = await getGmSession();
  if (!session?.discordUserId) redirect("/");
  if (!gm) redirect("/character");

  const characters = await prisma.character.findMany({
    orderBy: { name: "asc" },
    include: { faction: true, zone: true },
    // Safety net against unbounded growth, not a real limit — far above any
    // realistic roster size for this game (100+ players).
    take: 1000,
  });

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6 p-6 sm:p-8">
      <h1 className="text-2xl font-bold">Players</h1>
      <PlayersTable
        characters={characters.map((c) => ({
          id: c.id,
          name: c.name,
          roleTitle: c.roleTitle,
          factionName: c.faction?.name ?? "",
          zoneName: c.zone?.name ?? "",
          status: c.status,
          resources: c.resources,
        }))}
      />
    </div>
  );
}
