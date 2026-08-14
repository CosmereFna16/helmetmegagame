import { redirect } from "next/navigation";
import { prisma } from "@lifeweb/db";
import { auth } from "@/lib/auth";
import { getGuildMember, isGm } from "@/lib/discordGuild";
import PlayersTable from "./PlayersTable";

export default async function PlayersPage() {
  const session = await auth();
  if (!session?.discordUserId) redirect("/");
  const member = await getGuildMember(session.discordUserId);
  if (!isGm(member)) redirect("/character");

  const characters = await prisma.character.findMany({
    orderBy: { name: "asc" },
    include: { faction: true, zone: true },
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
