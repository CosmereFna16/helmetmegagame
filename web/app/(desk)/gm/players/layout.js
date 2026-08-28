import { prisma } from "@lifeweb/db";
import { getGmSession, listGuildMembers } from "@/lib/discordGuild";
import { getMyZones } from "@/lib/gmZone";
import { getOpenTurn } from "@/lib/turn";
import PlayerRail from "./PlayerRail";
import InboxPoller from "./InboxPoller";

// The player desk's server half. It owns the rail's data and nothing else:
// the child route loads its own conversation, and router.refresh() re-runs
// this layout so unread counts and previews stay live without a list-only
// poll.
//
// This used to be two screens. /gm/messages could only list players who had
// already sent a DM — the list came from a groupBy over DirectMessage — so
// there was no way to START a conversation, and /gm/players was a table you
// could not talk from. Merging them is what fixes that: the rail is the union
// of "everyone with a conversation" and "everyone with a character", so a
// player who has never written is one click from a reply box.
//
// The GM gate lives in (desk)/layout.js above this.

export default async function PlayerDeskLayout({ children }) {
  const { session } = await getGmSession();

  const [grouped, guildMembers, myZones, openTurn, characters] = await Promise.all([
    prisma.directMessage.groupBy({
      by: ["discordUserId"],
      _count: { _all: true },
      _max: { createdAt: true },
      orderBy: { _max: { createdAt: "desc" } },
    }),
    listGuildMembers(),
    getMyZones(),
    getOpenTurn(),
    prisma.character.findMany({
      orderBy: [{ firstName: "asc" }, { lastName: { sort: "asc", nulls: "first" } }],
      // Two different zones, and the difference matters: faction.zone is the
      // zone seat this character answers to, `zone` is where they are
      // physically standing.
      include: { faction: { include: { zone: true } }, zone: true },
      // Safety net against unbounded growth, not a real limit — far above any
      // realistic roster size for this game (100+ players).
      take: 1000,
    }),
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

  const countByUser = new Map(grouped.map((g) => [g.discordUserId, g._count._all]));
  const usernameById = new Map(guildMembers.map((mem) => [mem.id, mem.username]));

  // Cursed is a live Discord role, not a DB field — joined in by
  // discordUserId from the guild's member list rather than included above.
  const cursedRoleId = process.env.DISCORD_CURSED_ROLE_ID;
  const cursedUserIds = new Set(
    cursedRoleId ? guildMembers.filter((m) => m.roles.includes(cursedRoleId)).map((m) => m.id) : [],
  );

  // Name/role/faction/zone resolve together under one ALIVE-wins rule.
  // Splitting them into separate lookups is how a dead character's zone ends
  // up deciding a live player's row.
  const characterByUser = new Map();
  for (const c of characters) {
    const existing = characterByUser.get(c.discordUserId);
    if (!existing || c.status === "ALIVE") characterByUser.set(c.discordUserId, c);
  }

  const claims = await prisma.conversationMeta.findMany({
    where: { claimedByDiscordUserId: { not: null } },
  });
  const claimByUser = new Map(claims.map((c) => [c.playerDiscordUserId, c.claimedByDiscordUserId]));

  // The union: every player who has a conversation, plus every player who has
  // a character. A row can have one, the other, or both — a character with no
  // DM history is exactly the case the old inbox could not reach.
  const userIds = new Set([...countByUser.keys(), ...characterByUser.keys()]);

  const rows = [...userIds].map((discordUserId) => {
    const c = characterByUser.get(discordUserId) ?? null;
    const last = latestByUser.get(discordUserId) ?? null;
    const username = usernameById.get(discordUserId) ?? "";
    const authorLabel = !last
      ? ""
      : last.direction === "INBOUND"
        ? ""
        : last.authorDiscordUserId
          ? last.authorDiscordUserId === session.discordUserId
            ? "You: "
            : "GM: "
          : "Bot: ";
    return {
      discordUserId,
      characterId: c?.id ?? null,
      name: c?.name ?? username ?? discordUserId,
      roleTitle: c?.roleTitle ?? "",
      factionId: c?.factionId ?? null,
      factionName: c?.faction?.name ?? "",
      factionZoneName: c?.faction?.zone?.name ?? "",
      zoneName: c?.zone?.name ?? "",
      status: c?.status ?? null,
      resources: c?.resources ?? 0,
      cursed: cursedUserIds.has(discordUserId),
      username,
      preview: last ? `${authorLabel}${last.content}` : "",
      lastAtMs: last ? last.createdAt.getTime() : 0,
      lastDirection: last?.direction ?? null,
      count: countByUser.get(discordUserId) ?? 0,
      unreadCount: unreadByUser.get(discordUserId) ?? 0,
      claimedByDiscordUserId: claimByUser.get(discordUserId) ?? null,
    };
  });

  const unreadTotal = rows.filter((r) => r.unreadCount > 0).length;

  return (
    <div className="desk-shell">
      <header className="desk-header">
        <div className="flex items-center gap-3">
          <h1 className="section-title">Players</h1>
          <span className="chip">
            {openTurn
              ? `Turn ${openTurn.number} · ${openTurn.phase === "DAWN" ? "Dawn" : "Dusk"}`
              : "No turn open"}
          </span>
          <span className="chip text-xs text-muted">{rows.length} tracked</span>
          {unreadTotal > 0 && (
            <span className="chip text-xs text-muted">{unreadTotal} unread</span>
          )}
        </div>
      </header>

      <div className="desk-body desk-body--players">
        <PlayerRail
          rows={rows}
          myZoneNames={myZones.map((z) => z.name)}
          myDiscordUserId={session.discordUserId}
        />
        {children}
      </div>

      <InboxPoller />
    </div>
  );
}
