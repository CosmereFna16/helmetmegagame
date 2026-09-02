import { prisma, CATATONIC_SLUG } from "@lifeweb/db";
import { getGmSession, listGuildMembers } from "@/lib/discordGuild";
import { getMyZones } from "@/lib/gmZone";
import { getOpenTurn } from "@/lib/turn";
import { dmNoiseSql, genuineConversationSql, dmPreviewLabel } from "@/lib/dmThread";
import PlayerRail from "./PlayerRail";
import DeskHeader from "@/app/components/DeskHeader";
import InboxPoller from "./InboxPoller";
import LiveInboxPoller from "./LiveInboxPoller";
import DeskInboxCounts from "./DeskInboxCounts";
import { deployVersion } from "@/lib/deployVersion";
import { DeskStaleRefreshGate, DeskStaleChip } from "@/app/components/useDeskVersion";
import InspectorHost from "./InspectorHost";
import BulkMessageButton from "./BulkMessageButton";

// The player desk's server half. Owns the rail's data; the child route
// loads its own conversation. The rail is the union of "everyone with a
// conversation" and "everyone with a character". The GM gate lives in
// (desk)/layout.js above this.

export default async function PlayerDeskLayout({ children }) {
  const { session } = await getGmSession();

  const [guildMembers, myZones, openTurn, characters, characterTags, allTags, stagedEffects] =
    await Promise.all([
    listGuildMembers(),
    getMyZones(),
    getOpenTurn(),
    prisma.character.findMany({
      orderBy: [{ firstName: "asc" }, { lastName: { sort: "asc", nulls: "first" } }],
      // faction.zone is the zone seat this character answers to; `zone` is
      // where they are physically standing.
      include: { faction: { include: { zone: true } }, zone: true },
      take: 1000, // safety net, not a real limit
    }),
    // Held tags, ids only, ALIVE characters only — feeds rail/roster tag search.
    prisma.characterTag.findMany({
      where: { character: { status: "ALIVE" } },
      select: { characterId: true, tagId: true },
    }),
    // Names for the search field, and the catalog behind the inspector's
    // custom-tag door.
    prisma.tag.findMany({
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        slug: true,
        category: true,
        pointCost: true,
        group: { select: { id: true, name: true } },
      },
    }),
    // This turn's unapplied staging, so the shared inspector can dim a
    // staged removal / suffix a staged ± on both desks.
    prisma.stagedEffect.findMany({
      where: { appliedAt: null },
      select: { targetCharacterId: true, payload: true },
    }),
  ]);

  // Newest message per conversation. DISTINCT ON is Postgres-specific, no
  // Prisma equivalent; rides @@index([discordUserId, createdAt]). The noise
  // predicate (dmThread.js#withoutDmNoise) must stay null-safe: `NOT (x = y)`
  // is NULL, not true, when x is NULL, and a NULL predicate drops the row.
  // Two DISTINCT ON queries because genuineConversationSql additionally
  // drops bot/effect noise from the preview only, not the recency/unread state.
  const [latestMessages, genuineMessages, unreadRows, claims, clock] = await Promise.all([
    prisma.$queryRaw`
      SELECT DISTINCT ON ("discordUserId")
        "discordUserId", "id", "direction", "content", "authorDiscordUserId", "source", "createdAt"
      FROM "DirectMessage"
      WHERE ${dmNoiseSql()}
      ORDER BY "discordUserId", "createdAt" DESC
    `,
    prisma.$queryRaw`
      SELECT DISTINCT ON ("discordUserId")
        "discordUserId", "direction", "content", "authorDiscordUserId"
      FROM "DirectMessage"
      WHERE ${genuineConversationSql()}
      ORDER BY "discordUserId", "createdAt" DESC
    `,
    // Per-GM unread counts: INBOUND rows newer than this GM's read cursor
    // (epoch when no cursor row exists yet).
    prisma.$queryRaw`
      SELECT dm."discordUserId", COUNT(*)::int AS "unreadCount"
      FROM "DirectMessage" dm
      LEFT JOIN "ConversationRead" cr
        ON cr."playerDiscordUserId" = dm."discordUserId"
        AND cr."gmDiscordUserId" = ${session.discordUserId}
      WHERE dm."direction" = 'INBOUND'
        AND dm."createdAt" > COALESCE(cr."lastReadAt", to_timestamp(0))
        AND ${dmNoiseSql("dm")}
      GROUP BY dm."discordUserId"
    `,
    prisma.conversationMeta.findMany({
      where: {
        OR: [
          { claimedByDiscordUserId: { not: null } },
          { handledAt: { not: null } },
          { mutedAt: { not: null } },
        ],
      },
    }),
    // Database clock, not the web container's — a clock mismatch would make
    // every live-inbox patch win or none.
    prisma.$queryRaw`SELECT (EXTRACT(EPOCH FROM now()) * 1000)::double precision AS "nowMs"`,
  ]);
  const rowsAsOfMs = Number(clock[0].nowMs);

  const latestByUser = new Map(latestMessages.map((m) => [m.discordUserId, m]));
  const genuineByUser = new Map(genuineMessages.map((m) => [m.discordUserId, m]));
  const unreadByUser = new Map(unreadRows.map((r) => [r.discordUserId, r.unreadCount]));
  const claimByUser = new Map(claims.map((c) => [c.playerDiscordUserId, c.claimedByDiscordUserId]));
  const mutedUserIds = new Set(claims.filter((c) => c.mutedAt).map((c) => c.playerDiscordUserId));
  const handledAtByUser = new Map(
    claims.filter((c) => c.handledAt).map((c) => [c.playerDiscordUserId, c.handledAt.getTime()]),
  );

  const usernameById = new Map(guildMembers.map((mem) => [mem.id, mem.username]));
  const globalNameById = new Map(guildMembers.map((mem) => [mem.id, mem.globalName]));

  // Cursed is a live Discord role, not a DB field.
  const cursedRoleId = process.env.DISCORD_CURSED_ROLE_ID;
  const cursedUserIds = new Set(
    cursedRoleId ? guildMembers.filter((m) => m.roles.includes(cursedRoleId)).map((m) => m.id) : [],
  );

  // Name/role/faction/zone resolve together under one ALIVE-wins rule.
  const characterByUser = new Map();
  for (const c of characters) {
    const existing = characterByUser.get(c.discordUserId);
    if (!existing || c.status === "ALIVE") characterByUser.set(c.discordUserId, c);
  }

  // Who's AFK — feeds the rail avatar's badge.
  const catatonicTagId = allTags.find((t) => t.slug === CATATONIC_SLUG)?.id ?? null;
  const catatonicCharacterIds = new Set(
    characterTags.filter((ct) => ct.tagId === catatonicTagId).map((ct) => ct.characterId),
  );

  // Held-tag names per character, for the rail's fuzzy `tag` field.
  const tagNameById = new Map(allTags.map((t) => [t.id, t.name]));
  const tagNamesByCharacter = new Map();
  for (const ct of characterTags) {
    const name = tagNameById.get(ct.tagId);
    if (!name) continue;
    const list = tagNamesByCharacter.get(ct.characterId);
    if (list) list.push(name);
    else tagNamesByCharacter.set(ct.characterId, [name]);
  }

  // The union: every player who has a conversation, plus every player who has
  // a character. A row can have one, the other, or both — a character with no
  // DM history is exactly the case the old inbox could not reach.
  //
  // "Has a conversation" comes off latestByUser, which is the same noise
  // predicate a per-user COUNT would have used — so the union is identical,
  // one query cheaper.
  const userIds = new Set([...latestByUser.keys(), ...characterByUser.keys()]);

  const rows = [...userIds].map((discordUserId) => {
    const c = characterByUser.get(discordUserId) ?? null;
    const last = latestByUser.get(discordUserId) ?? null;
    const genuine = genuineByUser.get(discordUserId) ?? null;
    const username = usernameById.get(discordUserId) ?? "";
    const authorLabel = dmPreviewLabel(genuine, session.discordUserId);
    return {
      discordUserId,
      characterId: c?.id ?? null,
      avatarVersion: c?.updatedAt ? c.updatedAt.getTime() : null,
      name: c?.name ?? username ?? discordUserId,
      roleTitle: c?.roleTitle ?? "",
      factionId: c?.factionId ?? null,
      factionName: c?.faction?.name ?? "",
      factionZoneName: c?.faction?.zone?.name ?? "",
      zoneName: c?.zone?.name ?? "",
      status: c?.status ?? null,
      resources: c?.resources ?? 0,
      cursed: cursedUserIds.has(discordUserId),
      catatonic: c ? catatonicCharacterIds.has(c.id) : false,
      username,
      globalName: globalNameById.get(discordUserId) ?? "",
      preview: genuine ? `${authorLabel}${genuine.content}` : "",
      lastAtMs: last ? last.createdAt.getTime() : 0,
      lastDirection: last?.direction ?? null,
      // Whether a thread exists, not how long — avoids a per-user COUNT scan.
      hasConversation: latestByUser.has(discordUserId),
      unreadCount: unreadByUser.get(discordUserId) ?? 0,
      claimedByDiscordUserId: claimByUser.get(discordUserId) ?? null,
      // Handled only while the mark is at or after the last message; a new
      // inbound DM outruns it and the row is awaiting again.
      handled:
        handledAtByUser.has(discordUserId) &&
        handledAtByUser.get(discordUserId) >= (last ? last.createdAt.getTime() : 0),
      muted: mutedUserIds.has(discordUserId),
      tag: c ? (tagNamesByCharacter.get(c.id) ?? []).join(" ") : "",
      tagNames: c ? (tagNamesByCharacter.get(c.id) ?? []) : [],
    };
  });

  // BulkComposer's recipient pool: living characters only.
  const bulkCharacters = rows
    .filter((r) => r.characterId && r.status === "ALIVE")
    .map((r) => ({
      id: r.characterId,
      name: r.name,
      roleTitle: r.roleTitle,
      factionName: r.factionName,
      zoneName: r.zoneName,
    }));

  return (
    // Skips a hard-reload across the build boundary once deploy latches the
    // stale flag — same as /gm/turns.
    <DeskStaleRefreshGate>
    <div className="desk-shell">
      <DeskHeader
        title="Players"
        meta={
          <>
            <span className="chip">
              {openTurn
                ? `Turn ${openTurn.number} · ${openTurn.phase === "DAWN" ? "Dawn" : "Dusk"}`
                : "No turn open"}
            </span>
            <span className="chip text-xs text-muted">{rows.length} tracked</span>
            <DeskInboxCounts rows={rows} rowsAsOfMs={rowsAsOfMs} />
          </>
        }
        actions={
          <>
            <DeskStaleChip />
            <BulkMessageButton characters={bulkCharacters} />
          </>
        }
      />

      <div className="desk-body desk-body--players">
        <PlayerRail
          rows={rows}
          rowsAsOfMs={rowsAsOfMs}
          myZoneNames={myZones.map((z) => z.name)}
          myDiscordUserId={session.discordUserId}
        />
        {children}
        {/* The third column is the shell's, not the person view's: it stays
            put across a navigation (the roster included), which is the whole
            point of a persistent inspector. */}
        <InspectorHost
          rows={rows}
          stagedEffects={stagedEffects.map((e) => ({
            targetCharacterId: e.targetCharacterId,
            resources: e.payload?.resources ?? 0,
            tagPoints: e.payload?.tagPoints ?? 0,
            tagOps: e.payload?.tagOps ?? [],
          }))}
          currentTurnNumber={openTurn?.number ?? null}
          bulkCharacters={bulkCharacters}
          tagCatalog={allTags}
        />
      </div>

      <InboxPoller deployVersion={deployVersion()} />
      <LiveInboxPoller deployVersion={deployVersion()} />
    </div>
    </DeskStaleRefreshGate>
  );
}
