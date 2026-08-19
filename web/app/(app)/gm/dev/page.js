import { redirect } from "next/navigation";
import Link from "next/link";
import { prisma } from "@lifeweb/db";
import { auth } from "@/lib/auth";
import { isSuperadmin } from "@/lib/superadmin";
import { describeTurn, getOpenTurn } from "@/lib/turn";
import { updateGameConfig, updateCurrentTurn, updateNextTurn, forceAdvanceTurn, wipeGameData } from "./actions";

const WEATHER_OPTIONS = [
  { value: "CLEAR", label: "Clear" },
  { value: "FOG", label: "Fog" },
  { value: "RAIN", label: "Rain" },
  { value: "STORM", label: "Storm" },
  { value: "MIGRATION", label: "Migration" },
];

export default async function DevPanelPage() {
  const session = await auth();
  if (!session?.discordUserId) redirect("/");
  if (!isSuperadmin(session.discordUserId)) redirect("/character");

  const [config, openTurnRecord, lastTurn] = await Promise.all([
    prisma.gameConfig.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } }),
    getOpenTurn(),
    prisma.turn.findFirst({ orderBy: { number: "desc" } }),
  ]);

  const currentDay = openTurnRecord ? Math.ceil(openTurnRecord.number / 2) : Math.ceil(((lastTurn?.number ?? 0) + 1) / 2);
  const currentPhase = openTurnRecord?.phase ?? (lastTurn?.phase === "DAWN" ? "DUSK" : "DAWN");
  const currentWeather = openTurnRecord?.weather ?? "CLEAR";

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
          <label className="field">
            <span className="field-label">Weather</span>
            <select name="weather" defaultValue={currentWeather}>
              {WEATHER_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </label>
          <button type="submit" className="btn">Save</button>
        </form>

        <form action={forceAdvanceTurn} className="mt-3">
          <button type="submit" className="btn">End turn</button>
        </form>

        <p className="mt-3 text-xs" style={{ color: "var(--muted)" }}>
          Save overrides the current turn&apos;s day/phase/weather directly, without resolving Needs. End
          turn resolves Needs on the current turn (resource decay, hunger, mood expiry) and opens the next
          one — same as the automatic dawn/dusk advance.
        </p>
      </section>

      <section className="panel p-4">
        <h2 className="mb-3 font-bold">Next Turn</h2>
        <p className="mb-3 text-sm" style={{ color: "var(--muted)" }}>
          {config.nextWeather ? `Weather set to ${config.nextWeather}` : "Weather will be rolled automatically."}
          {config.nextTurnNote ? ` — note: "${config.nextTurnNote}"` : ""}
        </p>
        <form action={updateNextTurn} className="flex flex-col gap-3">
          <label className="field">
            <span className="field-label">Weather</span>
            <select name="weather" defaultValue={config.nextWeather ?? ""} style={{ maxWidth: "12rem" }}>
              <option value="">Random</option>
              {WEATHER_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="field-label">Note (optional)</span>
            <textarea name="note" defaultValue={config.nextTurnNote ?? ""} rows={2} />
          </label>
          <button type="submit" className="btn self-start">Save</button>
        </form>
        <p className="mt-3 text-xs" style={{ color: "var(--muted)" }}>
          Applies the next time the turn advances (via End turn above or the bot&apos;s automatic
          dawn/dusk cron), then clears itself.
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
            <span className="field-label">Resource ⬢ consumption / turn</span>
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
          <label className="field">
            <span className="field-label">Alcohol cost (resources)</span>
            <input type="number" name="alcoholCost" defaultValue={config.alcoholCost} />
          </label>
          <label className="field">
            <span className="field-label">Alcohol shield duration (turns)</span>
            <input type="number" name="alcoholShieldDurationTurns" defaultValue={config.alcoholShieldDurationTurns} />
          </label>
          <label className="field">
            <span className="field-label">Lifeweb Blood (0-100, raw override)</span>
            <input type="number" name="lifewebBlood" min="0" max="100" defaultValue={config.lifewebBlood} />
          </label>
          <label className="field">
            <span className="field-label">Lifeweb decay / turn</span>
            <input type="number" name="lifewebDecayPerTurn" defaultValue={config.lifewebDecayPerTurn} />
          </label>
          <label className="field">
            <span className="field-label">Drained duration (turns)</span>
            <input type="number" name="lifewebDrainedDurationTurns" defaultValue={config.lifewebDrainedDurationTurns} />
          </label>
          <label className="field">
            <span className="field-label">Production coefficient (Farming/Fishing/Herding)</span>
            <input type="number" step="0.05" name="productionCoefficient" defaultValue={config.productionCoefficient} />
          </label>
          <label className="flex items-center gap-2 text-sm col-span-full">
            <input type="checkbox" name="messageWipeEnabled" defaultChecked={config.messageWipeEnabled} />
            Wipe messages at Dawn (archives everything to #archive first — see docs/CHANNELS.md)
          </label>
          <div className="col-span-full">
            <button type="submit" className="btn">Save config</button>
          </div>
        </form>
        <p className="mt-3 text-xs" style={{ color: "var(--muted)" }}>
          Tupper/summary channels are the plain/public/private channels of a provisioned Location. Moves and Efforts
          come from channels named exactly &quot;moves&quot; and &quot;effort&quot;. With Dawn wipe enabled, forcing a
          turn advance into Dawn may take a few minutes to resolve. Production coefficient scales /labor&apos;s payouts
          immediately, but docs/documents.yaml&apos;s printed numbers only update after a dev runs
          <code>npm run db:sync-production-doc</code> by hand.
        </p>
      </section>

      <section className="panel p-4" style={{ borderColor: "var(--accent)" }}>
        <h2 className="mb-3 font-bold" style={{ color: "var(--accent)" }}>Restart Game</h2>
        <p className="mb-3 text-sm" style={{ color: "var(--muted)" }}>
          Wipes every character, Move, Desire, tag change request, default effort, note, DM log, and
          audit log entry; resets every Faction&apos;s Silo to 0 and the Game Config above to its
          defaults; deletes each character&apos;s personal Discord role and nickname; clears every
          message in #archive and #turns; and deletes every message, forum post, and thread (public or
          private) in every provisioned Location channel. Opens a fresh Turn 1, Dawn. Factions, Zones,
          Locations, the channels/categories themselves, and the Tag catalog are left in place, just
          emptied out. This cannot be undone.
        </p>
        <form action={wipeGameData} className="flex flex-wrap items-end gap-3">
          <label className="field">
            <span className="field-label">Type WIPE to confirm</span>
            <input type="text" name="confirm" autoComplete="off" style={{ width: "10rem" }} />
          </label>
          <button type="submit" className="btn" style={{ borderColor: "var(--accent)" }}>
            Wipe &amp; restart game
          </button>
        </form>
      </section>
    </div>
  );
}
