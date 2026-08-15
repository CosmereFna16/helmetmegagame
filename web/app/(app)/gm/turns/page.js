import { redirect } from "next/navigation";
import { prisma } from "@lifeweb/db";
import { getGmSession } from "@/lib/discordGuild";
import { describeTurn, getOpenTurn } from "@/lib/turn";
import TurnsTable from "./TurnsTable";
import AdjudicationsTable from "./AdjudicationsTable";
import { endTurn } from "../actions";

export default async function TurnsPage() {
  const { session, isGm: gm } = await getGmSession();
  if (!session?.discordUserId) redirect("/");
  if (!gm) redirect("/character");

  const [actions, adjudicated, openTurnRecord] = await Promise.all([
    prisma.action.findMany({
      where: { status: { not: "ADJUDICATED" } },
      orderBy: { createdAt: "desc" },
      include: { character: { include: { faction: true, zone: true } }, turn: true },
    }),
    prisma.action.findMany({
      where: { status: "ADJUDICATED" },
      orderBy: { createdAt: "desc" },
      include: { character: true, turn: true },
    }),
    getOpenTurn(),
  ]);

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6 p-6 sm:p-8">
      <h1 className="text-2xl font-bold">Turns</h1>

      <section className="panel p-4">
        <h2 className="mb-2 font-bold">Current Turn</h2>
        <div className="flex items-center gap-3 text-sm">
          <span>{openTurnRecord ? `${describeTurn(openTurnRecord).label} — OPEN` : "No turn open"}</span>
          <form action={endTurn}>
            <button type="submit" className="btn">
              End turn
            </button>
          </form>
        </div>
        <p className="mt-2 text-xs" style={{ color: "var(--muted)" }}>
          Turns advance automatically at dawn and dusk. Ending a turn manually resolves Needs (resource
          decay, hunger, mood expiry) for the current turn and immediately opens the next one — same as the
          automatic advance.
        </p>
      </section>

      <TurnsTable
        actions={actions.map((a) => ({
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
        }))}
      />

      <section className="flex flex-col gap-2">
        <h2 className="text-xl font-bold">Past Adjudications</h2>
        <AdjudicationsTable
          entries={adjudicated.map((a) => ({
            id: a.id,
            characterName: a.character.name,
            diceRoll: a.diceRoll,
            resultMessage: a.resultMessage,
            gmNotes: a.gmNotes,
            turnNumber: a.turn.number,
          }))}
        />
      </section>
    </div>
  );
}
