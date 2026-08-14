import { redirect } from "next/navigation";
import { prisma } from "@lifeweb/db";
import { getGmSession } from "@/lib/discordGuild";
import { describeTurn, getOpenTurn } from "@/lib/turn";
import TurnsTable from "./TurnsTable";
import AdjudicationsTable from "./AdjudicationsTable";
import { openTurn, closeTurn, setMovesChannel } from "../actions";

export default async function TurnsPage() {
  const { session, isGm: gm } = await getGmSession();
  if (!session?.discordUserId) redirect("/");
  if (!gm) redirect("/character");

  const [actions, adjudicated, openTurnRecord, config] = await Promise.all([
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
    prisma.gameConfig.findUnique({ where: { id: 1 } }),
  ]);

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6 p-6 sm:p-8">
      <h1 className="text-2xl font-bold">Turns</h1>

      <section className="panel p-4">
        <h2 className="mb-2 font-bold">Current Turn</h2>
        {openTurnRecord ? (
          <div className="flex items-center gap-3 text-sm">
            <span>{describeTurn(openTurnRecord).label} — OPEN</span>
            <form action={closeTurn}>
              <button type="submit" className="btn-quiet">
                Close turn
              </button>
            </form>
          </div>
        ) : (
          <form action={openTurn}>
            <button type="submit" className="btn">
              Open new turn
            </button>
          </form>
        )}
        <p className="mt-2 text-xs" style={{ color: "var(--muted)" }}>
          Turns advance automatically at dawn and dusk. Use these controls only for testing or emergency override.
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

      <section className="panel p-4">
        <h2 className="mb-2 font-bold">Moves Channel</h2>
        <p className="mb-2 text-sm" style={{ color: "var(--muted)" }}>
          Messages posted here become Move actions: the message is deleted, and the player is DMed to confirm.
          Current: {config?.movesChannelId ?? "(none set)"}
        </p>
        <form action={setMovesChannel} className="flex gap-2">
          <input
            name="channelId"
            placeholder="Channel ID"
            defaultValue={config?.movesChannelId ?? ""}
            className="text-input"
          />
          <button type="submit" className="btn">
            Save
          </button>
        </form>
        <p className="mt-2 text-xs" style={{ color: "var(--muted)" }}>
          Tupper and summary channels are no longer configured here — any standard text channel named with a
          &quot;»&quot; is a summary channel, and any text or forum channel named with a &quot;»&quot; is a
          tupper channel.
        </p>
      </section>

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
