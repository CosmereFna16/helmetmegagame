import { redirect } from "next/navigation";
import Link from "next/link";
import { prisma } from "@lifeweb/db";
import { auth } from "@/lib/auth";
import { isSuperadmin } from "@/lib/superadmin";
import { describeTurn, getOpenTurn } from "@/lib/turn";
import { updateGameConfig, updateCurrentTurn, forceAdvanceTurn } from "./actions";

export default async function DevPanelPage() {
  const session = await auth();
  if (!session?.discordUserId) redirect("/");
  if (!isSuperadmin(session.discordUserId)) redirect("/character");

  const [config, openTurnRecord, recentTurns] = await Promise.all([
    prisma.gameConfig.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } }),
    getOpenTurn(),
    prisma.turn.findMany({ orderBy: { number: "desc" }, take: 8 }),
  ]);

  const currentDay = openTurnRecord ? Math.ceil(openTurnRecord.number / 2) : Math.ceil(((recentTurns[0]?.number ?? 0) + 1) / 2);
  const currentPhase = openTurnRecord?.phase ?? (recentTurns[0]?.phase === "DAWN" ? "DUSK" : "DAWN");

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6 p-6 sm:p-8">
      <div>
        <h1 className="text-2xl font-bold">Dev Panel</h1>
        <p className="text-sm" style={{ color: "var(--muted)" }}>
          Superadmin only. Edits here bypass all game rules — use with care.
        </p>
        <nav className="mt-3 flex gap-4 text-sm">
          <Link href="/gm/dev/characters" className="menu-item">Characters</Link>
          <Link href="/gm/dev/factions" className="menu-item">Factions</Link>
          <Link href="/gm/dev/zones" className="menu-item">Zones</Link>
        </nav>
      </div>

      <section className="panel p-4">
        <h2 className="mb-3 font-bold">Current Turn</h2>
        <p className="mb-3 text-sm" style={{ color: "var(--muted)" }}>
          {openTurnRecord ? `${describeTurn(openTurnRecord).label} — OPEN` : "No turn is currently open."}
        </p>

        <form action={updateCurrentTurn} className="flex flex-wrap items-end gap-3">
          <label className="field">
            <span className="field-label">Day</span>
            <input type="number" name="day" min="1" defaultValue={currentDay} style={{ width: "6rem" }} />
          </label>
          <label className="field">
            <span className="field-label">Phase</span>
            <select name="phase" defaultValue={currentPhase}>
              <option value="DAWN">DAWN</option>
              <option value="DUSK">DUSK</option>
            </select>
          </label>
          <button type="submit" className="btn">Save</button>
        </form>

        <form action={forceAdvanceTurn} className="mt-3">
          <button type="submit" className="btn-quiet">Force next turn</button>
        </form>

        <p className="mt-3 text-xs" style={{ color: "var(--muted)" }}>
          Save overrides the current turn&apos;s day/phase directly, without resolving Needs. Force next turn
          resolves Needs on the current turn and opens the next one — the same thing End Turn does on the
          Turns page.
        </p>
      </section>

      <section className="panel p-4">
        <h2 className="mb-3 font-bold">Game Config</h2>
        <form action={updateGameConfig} className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <label className="field">
            <span className="field-label">Starting tag points</span>
            <input type="number" name="startingTagPoints" defaultValue={config.startingTagPoints} />
          </label>
          <label className="field">
            <span className="field-label">Resource consumption / turn</span>
            <input type="number" name="resourceConsumptionPerTurn" defaultValue={config.resourceConsumptionPerTurn} />
          </label>
          <label className="field">
            <span className="field-label">Mood duration (turns)</span>
            <input type="number" name="moodDurationTurns" defaultValue={config.moodDurationTurns} />
          </label>
          <label className="field">
            <span className="field-label">Hunger move penalty</span>
            <input type="number" name="hungerMovePenalty" defaultValue={config.hungerMovePenalty} />
          </label>
          <label className="field">
            <span className="field-label">Mood move penalty</span>
            <input type="number" name="moodMovePenalty" defaultValue={config.moodMovePenalty} />
          </label>
          <label className="field">
            <span className="field-label">Mood move bonus</span>
            <input type="number" name="moodMoveBonus" defaultValue={config.moodMoveBonus} />
          </label>
          <div className="col-span-full">
            <button type="submit" className="btn">Save config</button>
          </div>
        </form>
        <p className="mt-3 text-xs" style={{ color: "var(--muted)" }}>
          Tupper/summary channels are detected by name (any channel with &quot;»&quot;). Moves and Efforts
          come from channels named exactly &quot;moves&quot; and &quot;effort&quot;.
        </p>
      </section>

      <section className="panel p-4">
        <h2 className="mb-3 font-bold">Recent Turns</h2>
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Phase</th>
                <th>Status</th>
                <th>Game date</th>
              </tr>
            </thead>
            <tbody>
              {recentTurns.map((turn) => (
                <tr key={turn.id}>
                  <td>{turn.number}</td>
                  <td>{turn.phase}</td>
                  <td>{turn.status}</td>
                  <td>{turn.gameDate.toLocaleString()}</td>
                </tr>
              ))}
              {recentTurns.length === 0 && (
                <tr>
                  <td colSpan={4} className="text-center" style={{ color: "var(--muted)" }}>
                    No turns yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
