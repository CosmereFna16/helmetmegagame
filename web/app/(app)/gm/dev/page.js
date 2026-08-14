import { redirect } from "next/navigation";
import Link from "next/link";
import { prisma } from "@lifeweb/db";
import { auth } from "@/lib/auth";
import { isSuperadmin } from "@/lib/superadmin";
import { updateGameConfig, createTurn, updateTurn } from "./actions";

function toLocalInputValue(date) {
  const d = new Date(date);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default async function DevPanelPage() {
  const session = await auth();
  if (!session?.discordUserId) redirect("/");
  if (!isSuperadmin(session.discordUserId)) redirect("/character");

  const [config, turns] = await Promise.all([
    prisma.gameConfig.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } }),
    prisma.turn.findMany({ orderBy: { number: "desc" } }),
  ]);

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
          Tupper/summary channels are detected by name (any channel with &quot;»&quot;). The moves channel is
          still set from <Link href="/gm/turns" className="menu-item">Turns</Link>.
        </p>
      </section>

      <section className="panel p-4">
        <h2 className="mb-3 font-bold">Turns ({turns.length})</h2>
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Phase</th>
                <th>Status</th>
                <th>Game date</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {turns.map((turn) => (
                <tr key={turn.id}>
                  <td>
                    <form action={updateTurn} id={`turn-${turn.id}`} className="contents">
                      <input type="hidden" name="turnId" value={turn.id} />
                      <input
                        type="number"
                        name="number"
                        defaultValue={turn.number}
                        form={`turn-${turn.id}`}
                        className="text-input"
                        style={{ width: "5rem" }}
                      />
                    </form>
                  </td>
                  <td>
                    <select name="phase" defaultValue={turn.phase} form={`turn-${turn.id}`}>
                      <option value="DAWN">DAWN</option>
                      <option value="DUSK">DUSK</option>
                    </select>
                  </td>
                  <td>
                    <select name="status" defaultValue={turn.status} form={`turn-${turn.id}`}>
                      <option value="OPEN">OPEN</option>
                      <option value="RESOLVED">RESOLVED</option>
                    </select>
                  </td>
                  <td>
                    <input
                      type="datetime-local"
                      name="gameDate"
                      defaultValue={toLocalInputValue(turn.gameDate)}
                      form={`turn-${turn.id}`}
                      className="text-input"
                    />
                  </td>
                  <td>
                    <button type="submit" form={`turn-${turn.id}`} className="btn-quiet">
                      Save
                    </button>
                  </td>
                </tr>
              ))}
              {turns.length === 0 && (
                <tr>
                  <td colSpan={5} className="text-center" style={{ color: "var(--muted)" }}>
                    No turns yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <h3 className="mt-4 mb-2 font-bold text-sm">Create turn</h3>
        <form action={createTurn} className="flex flex-wrap items-end gap-3">
          <label className="field">
            <span className="field-label">Number</span>
            <input type="number" name="number" required style={{ width: "6rem" }} />
          </label>
          <label className="field">
            <span className="field-label">Phase</span>
            <select name="phase" defaultValue="DAWN">
              <option value="DAWN">DAWN</option>
              <option value="DUSK">DUSK</option>
            </select>
          </label>
          <label className="field">
            <span className="field-label">Status</span>
            <select name="status" defaultValue="OPEN">
              <option value="OPEN">OPEN</option>
              <option value="RESOLVED">RESOLVED</option>
            </select>
          </label>
          <label className="field">
            <span className="field-label">Game date</span>
            <input type="datetime-local" name="gameDate" />
          </label>
          <button type="submit" className="btn">Create</button>
        </form>
      </section>
    </div>
  );
}
