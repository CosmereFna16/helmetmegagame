import { redirect } from "next/navigation";
import { prisma } from "@lifeweb/db";
import { getGmSession, listGuildMembers } from "@/lib/discordGuild";
import { getMyZone } from "@/lib/gmZone";
import MessagesToolbar from "./MessagesToolbar";
import ConversationsTable from "./ConversationsTable";
import PageShell, { PageHeader } from "@/app/components/PageShell";

export default async function MessagesPage() {
  const { session, isGm: gm } = await getGmSession();
  if (!session?.discordUserId) redirect("/");
  if (!gm) redirect("/character");

  // Grouped in Postgres, not in JS over a `take`-limited page. This used to
  // pull the newest 1000 DirectMessage rows and bucket them here, which meant
  // that past ~1000 rows total — roughly two days at roster scale — any player
  // whose most recent message fell outside that window silently vanished from
  // the conversation list entirely. That is a correctness bug, not a slow
  // page: the GM has no way to tell a quiet player from a dropped one.
  const [grouped, guildMembers, myZone, aliveCharacters] = await Promise.all([
    prisma.directMessage.groupBy({
      by: ["discordUserId"],
      _count: { _all: true },
      _max: { createdAt: true },
      orderBy: { _max: { createdAt: "desc" } },
    }),
    listGuildMembers(),
    getMyZone(),
    prisma.character.findMany({
      where: { status: "ALIVE" },
      orderBy: [{ firstName: "asc" }, { lastName: { sort: "asc", nulls: "first" } }],
      select: { id: true, discordUserId: true, name: true },
    }),
  ]);

  // The newest message per conversation, in one round trip. DISTINCT ON is
  // Postgres-specific and has no Prisma equivalent; the alternative was a
  // findFirst per conversation, i.e. a query per player fanned out at once.
  // Rides the existing @@index([discordUserId, createdAt]).
  const latestMessages = await prisma.$queryRaw`
    SELECT DISTINCT ON ("discordUserId") "discordUserId", "id", "direction", "content", "createdAt"
    FROM "DirectMessage"
    ORDER BY "discordUserId", "createdAt" DESC
  `;
  const latestByUser = new Map(latestMessages.map((m) => [m.discordUserId, m]));

  const conversations = new Map();
  for (const g of grouped) {
    conversations.set(g.discordUserId, {
      discordUserId: g.discordUserId,
      lastMessage: latestByUser.get(g.discordUserId) ?? null,
      count: g._count._all,
    });
  }

  const usernameById = new Map(guildMembers.map((mem) => [mem.id, mem.username]));
  const discordUserIds = [...conversations.keys()];
  const characters = await prisma.character.findMany({
    where: { discordUserId: { in: discordUserIds } },
    select: {
      discordUserId: true,
      name: true,
      status: true,
      // A conversation is keyed on a Discord user, not a character, so the
      // zone seat has to come through the character rather than off the row.
      faction: { select: { zone: { select: { name: true } } } },
    },
  });
  // Name and zone resolve together under one ALIVE-wins rule. Splitting them
  // into two loops is how a dead character's faction ends up deciding a live
  // player's zone.
  const characterById = new Map();
  for (const c of characters) {
    const existing = characterById.get(c.discordUserId);
    if (!existing || c.status === "ALIVE") {
      characterById.set(c.discordUserId, {
        name: c.name,
        factionZoneName: c.faction?.zone?.name ?? "",
      });
    }
  }

  // Flattened to plain serializable fields — the table is a client component,
  // and it sorts on `lastAtMs` rather than on a Date it can't receive.
  // Both sides come from the same table, so every group has a latest message;
  // the filter is here so a row can never reach the client half-built if that
  // ever stops being true.
  const rows = [...conversations.values()].filter((row) => row.lastMessage).map((row) => ({
    discordUserId: row.discordUserId,
    name:
      characterById.get(row.discordUserId)?.name ??
      usernameById.get(row.discordUserId) ??
      row.discordUserId,
    // "" for a DM from someone with no character at all — the neutral chip.
    factionZoneName: characterById.get(row.discordUserId)?.factionZoneName ?? "",
    preview: `${row.lastMessage.direction === "OUTBOUND" ? "You: " : ""}${row.lastMessage.content}`,
    lastAtMs: row.lastMessage.createdAt.getTime(),
    count: row.count,
  }));

  return (
    <PageShell>
      <PageHeader
        title="Messages"
        subtitle="Every direct message the bot has sent or received, grouped by player."
      />

      <MessagesToolbar characters={aliveCharacters} />

      <ConversationsTable conversations={rows} myZoneName={myZone?.name ?? null} />
    </PageShell>
  );
}
