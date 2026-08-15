import { redirect } from "next/navigation";
import { prisma } from "@lifeweb/db";
import { getGmSession } from "@/lib/discordGuild";
import { describeTurn, getOpenTurn } from "@/lib/turn";
import AdjudicatePanel from "./AdjudicatePanel";

export default async function TurnsPage() {
  const { session, isGm: gm } = await getGmSession();
  if (!session?.discordUserId) redirect("/");
  if (!gm) redirect("/character");

  const [allActions, openTurnRecord] = await Promise.all([
    prisma.action.findMany({
      orderBy: { createdAt: "desc" },
      include: { character: { include: { faction: true, zone: true } }, turn: true },
    }),
    getOpenTurn(),
  ]);

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

  const adjudications = allActions
    .filter((a) => a.status === "ADJUDICATED")
    .map((a) => ({
      id: a.id,
      characterName: a.character.name,
      diceRoll: a.diceRoll,
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

      <AdjudicatePanel actions={actions} adjudications={adjudications} />
    </div>
  );
}
