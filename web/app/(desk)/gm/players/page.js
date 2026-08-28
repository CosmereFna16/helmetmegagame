import { prisma } from "@lifeweb/db";
import { listGuildMembers } from "@/lib/discordGuild";
import { getMyZone } from "@/lib/gmZone";
import { getOpenTurn } from "@/lib/turn";
import RosterTable from "./RosterTable";
import FactionsPanel from "./FactionsPanel";

// The desk with nobody selected: the roster, spanning the whole pane rather
// than leaving a dossier column empty beside it. Selecting someone in the rail
// swaps this out for their conversation — fleet view, then person view.
//
// The heavy loads live here rather than in the layout on purpose. The tag
// catalog and the faction tree are only needed by this view, and the layout
// re-runs on every router.refresh().

export default async function PlayerRosterPage({ searchParams }) {
  const [tags, factions, myZone, openTurn, params] = await Promise.all([
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
    prisma.faction.findMany({
      orderBy: { name: "asc" },
      include: { characters: { select: { id: true, name: true, isLeader: true } } },
    }),
    getMyZone(),
    getOpenTurn(),
    searchParams,
  ]);

  const [characters, members, actedCharacterIds, tagCounts] = await Promise.all([
    prisma.character.findMany({
      orderBy: [{ firstName: "asc" }, { lastName: { sort: "asc", nulls: "first" } }],
      include: { faction: { include: { zone: true } }, zone: true },
      take: 1000,
    }),
    // Cursed is a live Discord role, not a DB field. listGuildMembers is
    // TTL-cached, so the layout having already called it costs nothing here.
    listGuildMembers(),
    // "Has this player moved yet this turn" is the single most-asked question
    // in the back half of a turn and the old table could not answer it.
    openTurn
      ? prisma.action
          .findMany({ where: { turnId: openTurn.id }, select: { characterId: true } })
          .then((rows) => new Set(rows.map((r) => r.characterId)))
      : Promise.resolve(new Set()),
    prisma.characterTag.groupBy({ by: ["characterId"], _count: { _all: true } }),
  ]);

  const tagCountByCharacter = new Map(tagCounts.map((t) => [t.characterId, t._count._all]));
  const cursedRoleId = process.env.DISCORD_CURSED_ROLE_ID;
  const cursedUserIds = new Set(
    cursedRoleId ? members.filter((m) => m.roles.includes(cursedRoleId)).map((m) => m.id) : [],
  );

  return (
    <main className="desk-main">
      <RosterTable
        initialTab={params?.tab?.toString() ?? ""}
        characters={characters.map((c) => ({
          id: c.id,
          discordUserId: c.discordUserId,
          name: c.name,
          roleTitle: c.roleTitle,
          factionId: c.factionId,
          factionName: c.faction?.name ?? "",
          factionZoneName: c.faction?.zone?.name ?? "",
          zoneName: c.zone?.name ?? "",
          status: c.status,
          resources: c.resources,
          cursed: cursedUserIds.has(c.discordUserId),
          tagCount: tagCountByCharacter.get(c.id) ?? 0,
          acted: actedCharacterIds.has(c.id),
        }))}
        tags={tags}
        myZoneName={myZone?.name ?? null}
        hasOpenTurn={Boolean(openTurn)}
        factions={<FactionsPanel factions={factions} />}
        factionCount={factions.length}
      />
    </main>
  );
}
