import { redirect } from "next/navigation";
import { prisma } from "@lifeweb/db";
import { getGmSession } from "@/lib/discordGuild";
import { describeTurn, getOpenTurn } from "@/lib/turn";
import TurnsTable from "./TurnsTable";
import { openTurn, closeTurn, addTupperChannel, removeTupperChannel, setSummaryChannel } from "../actions";

export default async function TurnsPage() {
  const { session, isGm: gm } = await getGmSession();
  if (!session?.discordUserId) redirect("/");
  if (!gm) redirect("/character");

  const [actions, openTurnRecord, config] = await Promise.all([
    prisma.action.findMany({
      orderBy: { createdAt: "desc" },
      include: { character: { include: { faction: true, zone: true } }, turn: true },
    }),
    getOpenTurn(),
    prisma.gameConfig.findUnique({ where: { id: 1 } }),
  ]);
  const tupperChannelIds = config?.tupperChannelIds ?? [];

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
        <h2 className="mb-2 font-bold">Summary Channel</h2>
        <p className="mb-2 text-sm" style={{ color: "var(--muted)" }}>
          Public adjudications are posted here. Current: {config?.summaryChannelId ?? "(none set)"}
        </p>
        <form action={setSummaryChannel} className="flex gap-2">
          <input
            name="channelId"
            placeholder="Channel ID"
            defaultValue={config?.summaryChannelId ?? ""}
            className="text-input"
          />
          <button type="submit" className="btn">
            Save
          </button>
        </form>
      </section>

      <section className="panel p-4">
        <h2 className="mb-2 font-bold">Tupper Channels ({tupperChannelIds.length})</h2>
        <p className="mb-2 text-sm" style={{ color: "var(--muted)" }}>
          Messages sent in these channel/forum IDs are auto-proxied as the sender&apos;s character.
        </p>
        <ul className="mb-3 flex flex-col gap-1 text-sm">
          {tupperChannelIds.map((channelId) => (
            <li key={channelId} className="flex items-center gap-2">
              <span>{channelId}</span>
              <form action={removeTupperChannel}>
                <input type="hidden" name="channelId" value={channelId} />
                <button type="submit" className="btn-quiet">
                  Remove
                </button>
              </form>
            </li>
          ))}
        </ul>
        <form action={addTupperChannel} className="flex gap-2">
          <input name="channelId" placeholder="Channel or forum ID" required className="text-input" />
          <button type="submit" className="btn">
            Add
          </button>
        </form>
      </section>
    </div>
  );
}
