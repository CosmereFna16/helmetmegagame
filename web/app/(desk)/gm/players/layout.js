import { prisma, CATATONIC_SLUG } from "@lifeweb/db";
import { getGmSession, listGuildMembers } from "@/lib/discordGuild";
import { getMyZones } from "@/lib/gmZone";
import { getOpenTurn } from "@/lib/turn";
import { dmNoiseSql, genuineConversationSql } from "@/lib/dmThread";
import PlayerRail from "./PlayerRail";
import DeskHeader from "@/app/components/DeskHeader";
import InboxPoller from "./InboxPoller";
import { deployVersion } from "@/lib/deployVersion";
import { DeskStaleRefreshGate, DeskStaleChip } from "@/app/components/useDeskVersion";
import InspectorHost from "./InspectorHost";
import BulkMessageButton from "./BulkMessageButton";

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

  const [guildMembers, myZones, openTurn, characters, characterTags, allTags, stagedEffects] =
    await Promise.all([
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
    // Every held tag, ids only — the rail and the roster both search by tag
    // name ("who is a smith", "who has Pale"), and one grouped read beats a
    // per-character include on a 100+ roster.
    // ALIVE only: this powers search over the roster, and it re-runs on every
    // layout revalidation — no reason to drag a dead character's sheet along.
    prisma.characterTag.findMany({
      where: { character: { status: "ALIVE" } },
      select: { characterId: true, tagId: true },
    }),
    // Names for the search field above, and the catalog behind the
    // inspector's custom-tag door — one query for both rather than two.
    prisma.tag.findMany({
      orderBy: { name: "asc" },
      // No description: this projection is serialised into the client
      // InspectorHost on every layout render (every GM reply revalidates it),
      // and its two consumers — the rail's tag search and the custom-tag
      // dialog's Clone-from/Category lists — only need names and groups.
      select: {
        id: true,
        name: true,
        // For the rail's AFK badge — the one slug this layout reads.
        slug: true,
        category: true,
        pointCost: true,
        group: { select: { id: true, name: true } },
      },
    }),
    // This turn's (and any stray) unapplied staging, so the shared inspector
    // can dim a staged removal and suffix a staged ± on both desks rather
    // than only on /gm/turns. Ids and payload only — cheap.
    prisma.stagedEffect.findMany({
      where: { appliedAt: null },
      select: { targetCharacterId: true, payload: true },
    }),
  ]);

  // Newest message per conversation, one round trip. DISTINCT ON is
  // Postgres-specific and has no Prisma equivalent — the alternative is a
  // findFirst per conversation, i.e. a query fanned out per player at once.
  // Rides @@index([discordUserId, createdAt]).
  //
  // The noise predicate is the same one web/lib/dmThread.js#withoutDmNoise
  // applies to the thread, written out as SQL because this query cannot go
  // through Prisma. Without it the rail previewed and SORTED BY rows the
  // conversation pane hides — an inspect embed or a reply typed into the
  // ✏️ edit prompt would sit at the top of the inbox as if the player had
  // just written. Null-safe on purpose: `NOT (x = y)` is NULL, not true, for
  // every row where x is NULL, and a NULL predicate drops the row — that is
  // exactly the trap that once emptied every thread (PR #11).
  //
  // Kept as two DISTINCT ON queries rather than folded into one window-function
  // scan (two ROW_NUMBER()s over different filters in a single pass). That
  // would save one table scan, but this is the desk's hottest path and the two
  // predicates mean different things — one drives recency and unread state, the
  // other only the preview snippet. A deliberate choice for clarity: they run
  // in parallel below, so the saved scan buys no wall-clock time either.
  //
  // The rail's PREVIEW TEXT is the second, stricter query — genuineConversationSql
  // additionally drops bot/effect noise (a resource grant, a dev-panel
  // microaction summary, a Move-unlock notice) that isn't a real
  // conversational turn. Deliberately separate from latestMessages above:
  // the row's TIMESTAMP and its "awaiting reply" status still key off ANY
  // DM (latestByUser), so an automated notification still bumps the
  // relative-time chip — only the preview snippet skips past it to the last
  // thing a person actually said. Without this split, a resource grant sent
  // after a player's real question would show "Bot: You were given 1 ⬢." in
  // the rail, burying the question it's supposed to surface.
  //
  // These four depend on nothing above them and on nothing in each other, so
  // they go out in one batch rather than four round trips in a row. The maps
  // are built afterwards.
  const [latestMessages, genuineMessages, unreadRows, claims] = await Promise.all([
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
    // Per-GM unread counts: INBOUND rows newer than this GM's read cursor for
    // that conversation (epoch when no cursor row exists yet). Rides the same
    // @@index([direction, discordUserId, createdAt]).
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
  ]);

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

  // Who's AFK, from rows already in hand — feeds the rail avatar's badge.
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
    const authorLabel = !genuine
      ? ""
      : genuine.direction === "INBOUND"
        ? ""
        : genuine.authorDiscordUserId
          ? genuine.authorDiscordUserId === session.discordUserId
            ? "You: "
            : "GM: "
          : "Bot: ";
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
      // Whether there is a thread at all, not how long it is — the rail only
      // ever asked "count > 0", and a per-user COUNT groupBy is a whole extra
      // scan of DirectMessage to answer a boolean.
      hasConversation: latestByUser.has(discordUserId),
      unreadCount: unreadByUser.get(discordUserId) ?? 0,
      claimedByDiscordUserId: claimByUser.get(discordUserId) ?? null,
      // A GM said this one needs no reply — but only while the mark is at or
      // after the last message. The next inbound DM outruns the stamp and the
      // row is awaiting again, with nothing to clean up.
      handled:
        handledAtByUser.has(discordUserId) &&
        handledAtByUser.get(discordUserId) >= (last ? last.createdAt.getTime() : 0),
      // Desk-side only, and standing rather than self-expiring: a muted row
      // is out of the rail and out of both counts until a GM lifts it.
      muted: mutedUserIds.has(discordUserId),
      tag: c ? (tagNamesByCharacter.get(c.id) ?? []).join(" ") : "",
      tagNames: c ? (tagNamesByCharacter.get(c.id) ?? []) : [],
    };
  });

  const unreadTotal = rows.filter((r) => !r.muted && r.unreadCount > 0).length;
  // Read but still theirs to answer: they wrote last, and it's not sitting in
  // the unread count any more. Same predicate the rail's row mark uses.
  const awaitingTotal = rows.filter(
    (r) => !r.muted && !r.handled && r.unreadCount === 0 && r.lastDirection === "INBOUND",
  ).length;

  // BulkComposer's recipient pool: living characters only, since a broadcast
  // to a dead one is refused server-side anyway.
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
    // Once a deploy latches the desk-version stale flag, every refresh under
    // this gate (reply sends, note saves, the inbox poll) skips instead of
    // hard-reloading across the build boundary — same as /gm/turns.
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
            {unreadTotal > 0 && <span className="chip text-xs text-muted">{unreadTotal} unread</span>}
            {awaitingTotal > 0 && (
              <span className="chip text-xs text-muted">{awaitingTotal} awaiting</span>
            )}
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
          myZoneNames={myZones.map((z) => z.name)}
          myDiscordUserId={session.discordUserId}
        />
        {children}
        {/* The third column is the shell's, not the person view's: it stays
            put across a navigation (the roster included), which is the whole
            point of a persistent inspector. It replaced the per-person
            DossierColumn — Canon is an extra tab on it now. */}
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
    </div>
    </DeskStaleRefreshGate>
  );
}
