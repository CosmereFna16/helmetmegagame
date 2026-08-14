import { redirect } from "next/navigation";
import { prisma } from "@lifeweb/db";
import { auth } from "@/lib/auth";
import { getGuildMember, isGm } from "@/lib/discordGuild";
import {
  addTupperChannel,
  removeTupperChannel,
  setSummaryChannel,
  openTurn,
  closeTurn,
  adjudicateAction,
} from "./actions";

export default async function GmPage() {
  const session = await auth();
  if (!session?.discordUserId) redirect("/");

  const member = await getGuildMember(session.discordUserId);
  if (!isGm(member)) {
    return (
      <main className="p-8">
        <h1 className="text-2xl font-bold">Not authorized</h1>
        <p className="opacity-70">This area is restricted to the GM role.</p>
      </main>
    );
  }

  const [characters, auditLog, config, openTurnRecord, pendingActions] = await Promise.all([
    prisma.character.findMany({
      orderBy: { createdAt: "asc" },
      include: { faction: true, zone: true },
    }),
    prisma.auditLog.findMany({
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
    prisma.gameConfig.findUnique({ where: { id: 1 } }),
    prisma.turn.findFirst({ where: { status: "OPEN" } }),
    prisma.action.findMany({
      where: { status: "CONFIRMED" },
      orderBy: { confirmedAt: "asc" },
      include: { character: true, zone: true },
    }),
  ]);
  const tupperChannelIds = config?.tupperChannelIds ?? [];

  return (
    <main className="mx-auto flex max-w-4xl flex-col gap-8 p-8">
      <h1 className="text-3xl font-bold">GM Dashboard</h1>

      <section>
        <h2 className="mb-2 font-bold">Current Turn</h2>
        {openTurnRecord ? (
          <div className="flex items-center gap-3 text-sm">
            <span>
              Turn {openTurnRecord.number} — {openTurnRecord.phase} —{" "}
              {openTurnRecord.gameDate.toDateString()} — OPEN
            </span>
            <form action={closeTurn}>
              <button type="submit" className="menu-item text-xs">
                &gt; close turn
              </button>
            </form>
          </div>
        ) : (
          <form action={openTurn}>
            <button type="submit" className="menu-item text-xs">
              &gt; open new turn
            </button>
          </form>
        )}
      </section>

      <section>
        <h2 className="mb-2 font-bold">Pending Adjudication ({pendingActions.length})</h2>
        {pendingActions.length === 0 ? (
          <p className="text-sm opacity-60">Nothing waiting on you.</p>
        ) : (
          <ul className="flex flex-col gap-4">
            {pendingActions.map((action) => (
              <li key={action.id} className="crt-panel p-4 text-sm">
                <p className="mb-2">
                  <strong>{action.character.name}</strong> — {action.type}
                  {action.zone ? ` — ${action.zone.name}` : ""}
                  {action.diceRoll != null ? ` — rolled ${action.diceRoll}` : ""}
                </p>
                <p className="mb-3 opacity-80">{action.description}</p>
                <form action={adjudicateAction} className="flex flex-col gap-2">
                  <input type="hidden" name="actionId" value={action.id} />
                  <textarea
                    name="gmNotes"
                    placeholder="Resolution / summary text"
                    rows={2}
                    className="rounded border border-white/30 bg-transparent px-3 py-2"
                  />
                  <label className="flex items-center gap-2 text-xs">
                    <input type="checkbox" name="isPublic" defaultChecked />
                    Post to summary channel
                  </label>
                  <button type="submit" className="menu-item self-start text-xs">
                    &gt; adjudicate
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-2 font-bold">Summary Channel</h2>
        <p className="mb-2 text-sm opacity-70">
          Public adjudications are posted here. Current:{" "}
          {config?.summaryChannelId ?? "(none set)"}
        </p>
        <form action={setSummaryChannel} className="flex gap-2">
          <input
            name="channelId"
            placeholder="Channel ID"
            defaultValue={config?.summaryChannelId ?? ""}
            className="rounded border border-white/30 bg-transparent px-3 py-1 text-sm"
          />
          <button type="submit" className="menu-item text-xs">
            &gt; save
          </button>
        </form>
      </section>

      <section>
        <h2 className="mb-2 font-bold">Characters ({characters.length})</h2>
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-white/20 text-left">
              <th className="py-1">Name</th>
              <th>Role</th>
              <th>Faction</th>
              <th>Zone</th>
              <th>Status</th>
              <th>Resources</th>
              <th>Tag Pts</th>
            </tr>
          </thead>
          <tbody>
            {characters.map((character) => (
              <tr key={character.id} className="border-b border-white/10">
                <td className="py-1">{character.name}</td>
                <td>{character.roleTitle ?? "-"}</td>
                <td>{character.faction?.name ?? "-"}</td>
                <td>{character.zone?.name ?? "-"}</td>
                <td>{character.status}</td>
                <td>{character.resources}</td>
                <td>{character.tagPoints}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section>
        <h2 className="mb-2 font-bold">Tupper Channels ({tupperChannelIds.length})</h2>
        <p className="mb-2 text-sm opacity-70">
          Messages sent in these channel/forum IDs are auto-proxied as the sender&apos;s character.
        </p>
        <ul className="mb-3 flex flex-col gap-1 font-mono text-sm">
          {tupperChannelIds.map((channelId) => (
            <li key={channelId} className="flex items-center gap-2">
              <span>{channelId}</span>
              <form action={removeTupperChannel}>
                <input type="hidden" name="channelId" value={channelId} />
                <button type="submit" className="menu-item text-xs">
                  &gt; remove
                </button>
              </form>
            </li>
          ))}
        </ul>
        <form action={addTupperChannel} className="flex gap-2">
          <input
            name="channelId"
            placeholder="Channel or forum ID"
            required
            className="rounded border border-white/30 bg-transparent px-3 py-1 text-sm"
          />
          <button type="submit" className="menu-item text-xs">
            &gt; add
          </button>
        </form>
      </section>

      <section>
        <h2 className="mb-2 font-bold">Audit Log (latest 50)</h2>
        <ul className="flex flex-col gap-1 font-mono text-xs">
          {auditLog.map((entry) => (
            <li key={entry.id}>
              [{entry.createdAt.toISOString()}] {entry.actionType} — {entry.actorDiscordUserId}
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
