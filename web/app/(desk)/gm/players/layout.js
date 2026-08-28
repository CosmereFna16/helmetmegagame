import { redirect } from "next/navigation";
import { prisma } from "@lifeweb/db";
import { getGmSession, listGuildMembers } from "@/lib/discordGuild";
import { getMyZone } from "@/lib/gmZone";
import PageShell, { PageHeader } from "@/app/components/PageShell";
import ConversationList from "./ConversationList";
import InboxPoller from "./InboxPoller";
import InboxShell from "./InboxShell";

// The list used to be its own page (page.js), reloading in full every time a
// GM opened a thread. Now it's a persistent left pane: this layout owns every
// bit of list data, [discordUserId]/page.js only loads its own thread, and a
// deep link (from the Inspector, the audit log, a back button) still lands on
// a real URL with the list rendered alongside it — router.refresh() re-runs
// this layout, so unread counts and previews stay live without a dedicated
// list-only poll.
export default async function MessagesLayout({ children }) {
  const { session, isGm: gm } = await getGmSession();
  if (!session?.discordUserId) redirect("/");
  if (!gm) redirect("/character");

  const [grouped, guildMembers, myZone] = await Promise.all([
    prisma.directMessage.groupBy({
      by: ["discordUserId"],
      _count: { _all: true },
      _max: { createdAt: true },
      orderBy: { _max: { createdAt: "desc" } },
    }),
    listGuildMembers(),
    getMyZone(),
  ]);

  // Newest message per conversation, one round trip. DISTINCT ON is
  // Postgres-specific and has no Prisma equivalent — the alternative is a
  // findFirst per conversation, i.e. a query fanned out per player at once.
  // Rides @@index([discordUserId, createdAt]).
  const latestMessages = await prisma.$queryRaw`
    SELECT DISTINCT ON ("discordUserId")
      "discordUserId", "id", "direction", "content", "authorDiscordUserId", "source", "createdAt"
    FROM "DirectMessage"
    ORDER BY "discordUserId", "createdAt" DESC
  `;
  const latestByUser = new Map(latestMessages.map((m) => [m.discordUserId, m]));

  // Per-GM unread counts: INBOUND rows newer than this GM's read cursor for
  // that conversation (epoch when no cursor row exists yet). Rides the same
  // @@index([direction, discordUserId, createdAt]).
  const unreadRows = await prisma.$queryRaw`
    SELECT dm."discordUserId", COUNT(*)::int AS "unreadCount"
    FROM "DirectMessage" dm
    LEFT JOIN "ConversationRead" cr
      ON cr."playerDiscordUserId" = dm."discordUserId"
      AND cr."gmDiscordUserId" = ${session.discordUserId}
    WHERE dm."direction" = 'INBOUND'
      AND dm."createdAt" > COALESCE(cr."lastReadAt", to_timestamp(0))
    GROUP BY dm."discordUserId"
  `;
  const unreadByUser = new Map(unreadRows.map((r) => [r.discordUserId, r.unreadCount]));

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

  const [characters, claims] = await Promise.all([
    prisma.character.findMany({
      where: { discordUserId: { in: discordUserIds } },
      select: {
        discordUserId: true,
        name: true,
        status: true,
        role: { select: { name: true } },
        faction: { select: { name: true } },
        zone: { select: { name: true } },
      },
    }),
    prisma.conversationMeta.findMany({
      where: { playerDiscordUserId: { in: discordUserIds }, claimedByDiscordUserId: { not: null } },
    }),
  ]);

  // Name/role/faction/zone resolve together under one ALIVE-wins rule.
  // Splitting them into separate lookups is how a dead character's zone ends
  // up deciding a live player's row.
  const characterById = new Map();
  for (const c of characters) {
    const existing = characterById.get(c.discordUserId);
    if (!existing || c.status === "ALIVE") {
      characterById.set(c.discordUserId, {
        name: c.name,
        roleName: c.role?.name ?? "",
        factionName: c.faction?.name ?? "",
        zoneName: c.zone?.name ?? "",
      });
    }
  }
  const claimByUser = new Map(claims.map((c) => [c.playerDiscordUserId, c.claimedByDiscordUserId]));

  const conversationRows = [...conversations.values()]
    .filter((row) => row.lastMessage)
    .map((row) => {
      const char = characterById.get(row.discordUserId);
      const username = usernameById.get(row.discordUserId) ?? null;
      const last = row.lastMessage;
      const authorLabel =
        last.direction === "INBOUND"
          ? ""
          : last.authorDiscordUserId
            ? last.authorDiscordUserId === session.discordUserId
              ? "You: "
              : "GM: "
            : "Bot: ";
      return {
        discordUserId: row.discordUserId,
        name: char?.name ?? username ?? row.discordUserId,
        roleName: char?.roleName ?? "",
        factionName: char?.factionName ?? "",
        zoneName: char?.zoneName ?? "",
        username: username ?? "",
        preview: `${authorLabel}${last.content}`,
        lastAtMs: last.createdAt.getTime(),
        lastDirection: last.direction,
        count: row.count,
        unreadCount: unreadByUser.get(row.discordUserId) ?? 0,
        claimedByDiscordUserId: claimByUser.get(row.discordUserId) ?? null,
      };
    });

  return (
    <PageShell width="wide">
      <PageHeader
        title="Messages"
        subtitle="Every direct message the bot has sent or received, grouped by player."
      />
      <InboxShell>
        <ConversationList
          conversations={conversationRows}
          myZoneName={myZone?.name ?? null}
          myDiscordUserId={session.discordUserId}
        />
        <div className="inbox-thread-pane">{children}</div>
      </InboxShell>
      <InboxPoller />
    </PageShell>
  );
}
