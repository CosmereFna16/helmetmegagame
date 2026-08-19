import { redirect } from "next/navigation";
import { prisma } from "@lifeweb/db";
import { getGmSession } from "@/lib/discordGuild";
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

  const [pendingActions, historyActions, openTurnRecord] = await Promise.all([
    prisma.action.findMany({
      where: {
        OR: [
          { status: { in: ["PENDING_TYPE", "PENDING_OPPOSED", "PENDING"] } },
          { status: "CONFIRMED", moveReviewStatus: { not: "SOLVED" } },
        ],
      },
      orderBy: { createdAt: "desc" },
      include: { character: { include: { faction: true, zone: true } }, turn: true },
    }),
    prisma.action.findMany({
      where: { OR: [{ status: "ADJUDICATED" }, { status: "CONFIRMED", moveReviewStatus: "SOLVED" }] },
      orderBy: { createdAt: "desc" },
      take: HISTORY_TAKE,
      include: { character: { include: { faction: true, zone: true } }, turn: true },
    }),
    getOpenTurn(),
  ]);

  const allCharacters = await prisma.character.findMany({
    where: { status: "ALIVE" },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });

  const allActions = [...pendingActions, ...historyActions].sort((a, b) => b.createdAt - a.createdAt);

  const actions = allActions.map((a) => ({
    id: a.id,
    characterId: a.characterId,
    characterName: a.character.name,
    factionId: a.character.factionId,
    factionName: a.character.faction?.name ?? "",
    zoneName: a.character.zone?.name ?? "",
    type: a.type,
    status: a.status,
    moveKind: a.moveKind,
    opposed: a.opposed,
    moveReviewStatus: a.moveReviewStatus,
    description: a.description,
    diceRoll: a.diceRoll,
    resourceDelta: a.resourceDelta,
    resultMessage: a.resultMessage,
    gmNotes: a.gmNotes,
    turnNumber: a.turn.number,
    turnPhase: a.turn.phase,
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

      <AdjudicatePanel actions={actions} allCharacters={allCharacters} />
    </div>
  );
}
