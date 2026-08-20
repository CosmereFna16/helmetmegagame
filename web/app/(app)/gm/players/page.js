import { redirect } from "next/navigation";
import { prisma } from "@lifeweb/db";
import { getGmSession, listGuildMembers } from "@/lib/discordGuild";
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

  // Cursed is a live Discord role, not a DB field — joined in by
  // discordUserId from the guild's member list rather than included above.
  const cursedRoleId = process.env.DISCORD_CURSED_ROLE_ID;
  const members = await listGuildMembers();
  const cursedUserIds = new Set(
    cursedRoleId ? members.filter((m) => m.roles.includes(cursedRoleId)).map((m) => m.id) : [],
  );

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6 p-6 sm:p-8">
      <h1 className="text-2xl font-bold">Players</h1>
      <PlayersTable
        characters={characters.map((c) => ({
          id: c.id,
          name: c.name,
          roleTitle: c.roleTitle,
          factionId: c.factionId,
          factionName: c.faction?.name ?? "",
          zoneName: c.zone?.name ?? "",
          status: c.status,
          cursed: cursedUserIds.has(c.discordUserId),
          resources: c.resources,
        }))}
      />
    </div>
  );
}
