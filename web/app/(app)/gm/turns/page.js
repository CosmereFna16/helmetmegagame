import { redirect } from "next/navigation";
import { prisma } from "@lifeweb/db";
import { getGmSession, listGuildMembers } from "@/lib/discordGuild";
import { describeTurn, getOpenTurn } from "@/lib/turn";
import AdjudicatePanel from "./AdjudicatePanel";

// Terminal-status rows only grow for the rest of the month-long game; the
// most recent HISTORY_TAKE is enough for history browsing. Non-terminal
// (still-needs-GM-attention) rows are never capped — they're bounded by
// outstanding queue size, not by how long the game has been running, and
// truncating a still-PENDING/CONFIRMED item would silently hide it from GMs.
const HISTORY_TAKE = 500;

export default async function TurnsPage() {
  const { session, isGm: gm } = await getGmSession();
  if (!session?.discordUserId) redirect("/");
  if (!gm) redirect("/character");

  const [
    pendingActions,
    historyActions,
    pendingDesires,
    historyDesires,
    pendingTagRequests,
    historyTagRequests,
    allTurns,
    openTurnRecord,
    guildMembers,
  ] = await Promise.all([
    prisma.action.findMany({
      where: { status: { in: ["PENDING_TYPE", "PENDING", "CONFIRMED"] } },
      orderBy: { createdAt: "desc" },
      include: { character: { include: { faction: true, zone: true } }, turn: true },
    }),
    prisma.action.findMany({
      where: { status: "ADJUDICATED" },
      orderBy: { createdAt: "desc" },
      take: HISTORY_TAKE,
      include: { character: { include: { faction: true, zone: true } }, turn: true },
    }),
    prisma.desire.findMany({
      where: { status: { in: ["ACTIVE", "PENDING"] } },
      orderBy: { createdAt: "desc" },
      include: { character: { include: { faction: true } } },
    }),
    prisma.desire.findMany({
      where: { status: { in: ["COMPLETED", "ABANDONED"] } },
      orderBy: { createdAt: "desc" },
      take: HISTORY_TAKE,
      include: { character: { include: { faction: true } } },
    }),
    prisma.tagChangeRequest.findMany({
      where: { status: "PENDING" },
      orderBy: { createdAt: "desc" },
      include: { character: { include: { faction: true } } },
    }),
    prisma.tagChangeRequest.findMany({
      where: { status: "RESOLVED" },
      orderBy: { createdAt: "desc" },
      take: HISTORY_TAKE,
      include: { character: { include: { faction: true } } },
    }),
    prisma.turn.findMany({ select: { number: true, phase: true } }),
    getOpenTurn(),
    listGuildMembers(),
  ]);

  const allActions = [...pendingActions, ...historyActions].sort((a, b) => b.createdAt - a.createdAt);
  const allDesires = [...pendingDesires, ...historyDesires].sort((a, b) => b.createdAt - a.createdAt);
  const allTagRequests = [...pendingTagRequests, ...historyTagRequests].sort((a, b) => b.createdAt - a.createdAt);

  const usernameById = new Map(guildMembers.map((m) => [m.id, m.username]));
  const requesterDiscordUserIds = [...new Set(allTagRequests.map((r) => r.requestedByDiscordUserId))];
  const requesterCharacters = await prisma.character.findMany({
    where: { discordUserId: { in: requesterDiscordUserIds } },
    select: { discordUserId: true, name: true, status: true },
  });
  const requesterNameById = new Map();
  for (const c of requesterCharacters) {
    const existing = requesterNameById.get(c.discordUserId);
    if (!existing || c.status === "ALIVE") requesterNameById.set(c.discordUserId, c.name);
  }

  const phaseByTurnNumber = new Map(allTurns.map((t) => [t.number, t.phase]));

  const actions = allActions.map((a) => ({
    id: a.id,
    characterId: a.characterId,
    characterName: a.character.name,
    factionName: a.character.faction?.name ?? "",
    zoneName: a.character.zone?.name ?? "",
    type: a.type,
    status: a.status,
    description: a.description,
    diceRoll: a.diceRoll,
    turnNumber: a.turn.number,
    turnPhase: a.turn.phase,
  }));

  const desires = allDesires.map((d) => ({
    id: d.id,
    characterId: d.characterId,
    characterName: d.character.name,
    factionName: d.character.faction?.name ?? "",
    description: d.description,
    status: d.status,
    pointsAwarded: d.pointsAwarded,
    resultMessage: d.resultMessage,
    gmNotes: d.gmNotes,
    turnNumber: d.turnNumber,
    turnPhase: d.turnNumber != null ? phaseByTurnNumber.get(d.turnNumber) : null,
  }));

  const tagRequests = allTagRequests.map((r) => ({
    id: r.id,
    characterId: r.characterId,
    characterName: r.character.name,
    factionName: r.character.faction?.name ?? "",
    requestedByName:
      requesterNameById.get(r.requestedByDiscordUserId) ??
      usernameById.get(r.requestedByDiscordUserId) ??
      r.requestedByDiscordUserId,
    description: r.description,
    status: r.status,
    resultMessage: r.resultMessage,
    gmNotes: r.gmNotes,
  }));

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6 p-6 sm:p-8">
      <h1 className="text-2xl font-bold">Adjudicate</h1>

      <section className="panel p-4">
        <h2 className="mb-2 font-bold">Current Turn</h2>
        <p className="text-sm">{openTurnRecord ? `${describeTurn(openTurnRecord).label} — OPEN` : "No turn open"}</p>
        <p className="mt-2 text-xs" style={{ color: "var(--muted)" }}>
          Turns advance automatically at dawn and dusk. Ending a turn manually is done from the Dev Panel.
        </p>
      </section>

      <AdjudicatePanel actions={actions} desires={desires} tagRequests={tagRequests} />
    </div>
  );
}
