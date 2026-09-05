import { redirect } from "next/navigation";
import { prisma } from "@lifeweb/db";
import { getGmSession, listGuildMembers } from "@/lib/discordGuild";
import { getGmProfiles } from "@/lib/gmProfiles";
import { getOpenTurn } from "@/lib/turn";
import { sortZones } from "@/lib/zones";
import {
  PAGE_SIZE,
  buildAuditWhere,
  loadAuditContext,
  parseAuditParams,
  turnAt,
} from "@/lib/auditQuery";
import AuditDesk from "../AuditDesk";

// The audit desk's server half: one load, all DTOs, no Prisma-shaped object
// across the client boundary — the same rule the adjudication desk states.
//
// Open to every GM. It used to be superadmin-only on the argument that with
// five GMs the log is a record OF them rather than a tool FOR them; in
// practice that left four people unable to answer "who changed this", which is
// the question the log exists for. Peer visibility is the point now, and the
// Actor filter's GMs-only toggle makes reviewing each other a first-class
// view rather than a thing you squint for.
//
// The (desk) layout already redirects a non-GM; the check below is the same
// belt as every other page in the group, and the export action re-checks for
// real.

export default async function AuditPage({ params, searchParams }) {
  const { session, isGm } = await getGmSession();
  if (!session?.discordUserId) redirect("/");
  if (!isGm) redirect("/character");

  const [routeParams, rawSearch] = await Promise.all([params, searchParams]);
  const selectedId = routeParams?.entryId?.[0] ?? null;
  const filters = parseAuditParams(rawSearch);

  const [guildMembers, gmProfiles, openTurn, zones, factions] = await Promise.all([
    listGuildMembers(),
    getGmProfiles(),
    getOpenTurn(),
    // Seat zones: every stamped zoneId in the app is one, so the three cave
    // levels would be four filter options nothing ever matches.
    prisma.zone.findMany({ where: { kind: { not: "CAVE_LEVEL" } }, select: { id: true, name: true } }),
    prisma.faction.findMany({ select: { id: true, name: true } }),
  ]);

  const gmIds = gmProfiles.map((p) => p.discordUserId);
  const ctx = await loadAuditContext({ gmIds, guildMembers });

  const where = await buildAuditWhere(filters, ctx);

  const [rows, total, typeCounts] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (filters.page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: { targetCharacter: { select: { id: true, name: true } } },
    }),
    prisma.auditLog.count({ where }),
    // Counts beside each entry in the type picker, over the CURRENT filter
    // minus the type filter itself — so picking one type does not collapse
    // every other count to zero and strand the GM there.
    prisma.auditLog.groupBy({
      by: ["actionType"],
      _count: { _all: true },
      where: await buildAuditWhere({ ...filters, types: [] }, ctx),
      orderBy: { _count: { actionType: "desc" } },
      take: 200,
    }),
  ]);

  // A permalink may name a row that is not on this page — a different filter,
  // or forty pages back. Fetch it alongside rather than making the reader hunt.
  const pinned =
    selectedId && !rows.some((r) => r.id === selectedId)
      ? await prisma.auditLog.findUnique({
          where: { id: selectedId },
          include: { targetCharacter: { select: { id: true, name: true } } },
        })
      : null;

  // id -> name for everything a `details` blob can point at, so a sentence can
  // say "Black Hills" where the payload says a cuid. Tags are the only list here
  // with real size, and it is a few hundred rows of two columns.
  const tags = await prisma.tag.findMany({ select: { id: true, name: true } });
  const names = Object.fromEntries([
    ...tags.map((t) => [t.id, t.name]),
    ...factions.map((f) => [f.id, f.name]),
    ...zones.map((z) => [z.id, z.name]),
    ...ctx.characters.map((c) => [c.id, c.name]),
  ]);

  const usernameById = new Map(
    guildMembers.map((m) => [m.id, m.globalName ?? m.username ?? m.id]),
  );
  const gmProfileById = new Map(gmProfiles.map((p) => [p.discordUserId, p]));
  const gmIdSet = new Set(gmIds);
  // A player's live character, so a row's actor reads as a person rather than
  // a snowflake. ALIVE wins when someone has re-rolled.
  const characterByUser = new Map();
  for (const c of ctx.characters) {
    const existing = characterByUser.get(c.discordUserId);
    if (!existing || c.status === "ALIVE") characterByUser.set(c.discordUserId, c);
  }

  function toDto(row) {
    const turn = turnAt(ctx.turns, row.createdAt);
    const character = characterByUser.get(row.actorDiscordUserId) ?? null;
    const isSystem = row.actorDiscordUserId === "system";
    return {
      id: row.id,
      actionType: row.actionType,
      createdAt: row.createdAt.toISOString(),
      reason: row.reason ?? null,
      details: row.details ?? null,
      actor: {
        discordUserId: row.actorDiscordUserId,
        name: isSystem ? "The turn engine" : usernameById.get(row.actorDiscordUserId) ?? row.actorDiscordUserId,
        avatarUrl: gmProfileById.get(row.actorDiscordUserId)?.avatarUrl ?? null,
        kind: isSystem ? "system" : gmIdSet.has(row.actorDiscordUserId) ? "gm" : "player",
        characterId: character?.id ?? null,
        characterName: character?.name ?? null,
      },
      target: row.targetCharacter ? { id: row.targetCharacter.id, name: row.targetCharacter.name } : null,
      turnNumber: turn?.number ?? null,
      turnPhase: turn?.phase ?? null,
    };
  }

  const entries = rows.map(toDto);

  // Actor options: everyone who has ever been an actor is not a list we hold,
  // so this is the guild's GMs plus everyone with a character — the same union
  // the player desk's rail builds, and the same people who write rows.
  const actorOptions = [
    ...gmProfiles.map((p) => ({
      id: p.discordUserId,
      name: usernameById.get(p.discordUserId) ?? p.discordUserId,
      kind: "gm",
      avatarUrl: p.avatarUrl ?? null,
    })),
    ...ctx.characters
      .filter((c) => c.discordUserId && !gmIdSet.has(c.discordUserId))
      .map((c) => ({ id: c.discordUserId, name: c.name, kind: "player", avatarUrl: null })),
  ];
  // One row per Discord ID; a player with two characters is still one actor.
  const actorById = new Map(actorOptions.map((a) => [a.id, a]));

  return (
    <AuditDesk
      entries={entries}
      // One shared id -> name map rather than a copy per row: at 60 rows and a
      // few hundred tags, hanging it off each DTO would be most of the payload.
      names={names}
      pinned={pinned ? toDto(pinned) : null}
      selectedId={selectedId}
      total={total}
      pageSize={PAGE_SIZE}
      filters={serializeFilters(filters)}
      openTurn={openTurn ? { number: openTurn.number, phase: openTurn.phase } : null}
      typeCounts={typeCounts.map((t) => ({ actionType: t.actionType, count: t._count._all }))}
      actors={[...actorById.values()].sort((a, b) => a.name.localeCompare(b.name))}
      characters={ctx.characters
        .map((c) => ({
          id: c.id,
          name: c.name,
          status: c.status,
          factionName: c.faction?.name ?? null,
        }))
        .sort((a, b) => a.name.localeCompare(b.name))}
      factions={factions.sort((a, b) => a.name.localeCompare(b.name))}
      zones={sortZones(zones)}
      turnNumbers={ctx.turns.map((t) => t.number)}
    />
  );
}

// Dates cannot cross to a client component as Date objects without becoming
// something the filter controls cannot echo back, so they travel as the same
// YYYY-MM-DD strings the inputs use.
function serializeFilters(filters) {
  return {
    ...filters,
    from: filters.from ? filters.from.toISOString().slice(0, 10) : "",
    to: filters.to ? filters.to.toISOString().slice(0, 10) : "",
  };
}
