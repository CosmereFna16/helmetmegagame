import { redirect } from "next/navigation";
import { prisma } from "@lifeweb/db";
import { getGmSession, listGuildMembers } from "@/lib/discordGuild";
import { getMyZone } from "@/lib/gmZone";
import PlayersTable from "./PlayersTable";
import PlayersTabs from "./PlayersTabs";
import FactionsPanel from "./FactionsPanel";
import PageShell, { PageHeader } from "@/app/components/PageShell";

export default async function PlayersPage({ searchParams }) {
  const { session, isGm: gm } = await getGmSession();
  if (!session?.discordUserId) redirect("/");
  if (!gm) redirect("/character");

  // Everything below is independent — four DB queries plus the Discord
  // member-list HTTP call and the zone seat — so run it all in parallel
  // rather than paying for each round trip in sequence.
  const [tags, characters, factions, members, myZone] = await Promise.all([
    // The whole catalog, gates and all: bulk tagging is a GM grant, which
    // deliberately ignores requiredTag and the TagGroup gate (TAGS.md).
    prisma.tag.findMany({
      orderBy: [{ category: "asc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        category: true,
        description: true,
        pointCost: true,
        // The bulk-tag picker sorts chain-aware; without parentTagId the
        // chain walk degrades to plain alphabetical.
        parentTagId: true,
        group: { select: { name: true } },
      },
    }),
    prisma.character.findMany({
      orderBy: [{ firstName: "asc" }, { lastName: { sort: "asc", nulls: "first" } }],
      // Two different zones, and the difference matters: faction.zone is the
      // zone seat this character answers to, `zone` is where they are
      // physically standing. The table shows both, under "Zone" and
      // "Standing in".
      include: { faction: { include: { zone: true } }, zone: true },
      // Safety net against unbounded growth, not a real limit — far above any
      // realistic roster size for this game (100+ players).
      take: 1000,
    }),
    // The Factions tab. Same query the GM overview has always run — it just
    // lives here now instead of on /faction.
    prisma.faction.findMany({
      orderBy: { name: "asc" },
      include: { characters: { select: { id: true, name: true, isLeader: true } } },
    }),
    // Cursed is a live Discord role, not a DB field — joined in by
    // discordUserId from the guild's member list rather than included above.
    listGuildMembers(),
    getMyZone(),
  ]);

  const cursedRoleId = process.env.DISCORD_CURSED_ROLE_ID;
  const cursedUserIds = new Set(
    cursedRoleId ? members.filter((m) => m.roles.includes(cursedRoleId)).map((m) => m.id) : [],
  );

  const params = await searchParams;

  return (
    <PageShell>
      <PageHeader title="Players" />
      <PlayersTabs
        initialTab={params?.tab?.toString() ?? ""}
        playerCount={characters.length}
        factionCount={factions.length}
        players={
          <PlayersTable
            characters={characters.map((c) => ({
              id: c.id,
              name: c.name,
              roleTitle: c.roleTitle,
              factionId: c.factionId,
              factionName: c.faction?.name ?? "",
              factionZoneName: c.faction?.zone?.name ?? "",
              zoneName: c.zone?.name ?? "",
              status: c.status,
              cursed: cursedUserIds.has(c.discordUserId),
              resources: c.resources,
            }))}
            tags={tags}
            myZoneName={myZone?.name ?? null}
          />
        }
        factions={<FactionsPanel factions={factions} />}
      />
    </PageShell>
  );
}
