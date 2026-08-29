import SubmitButton from "@/app/components/SubmitButton";
import { redirect } from "next/navigation";
import Link from "next/link";
import { prisma } from "@lifeweb/db";
import { auth } from "@/lib/auth";
import { isSuperadmin } from "@/lib/superadmin";
import { getOpenTurn } from "@/lib/turn";
import { describeTurn } from "@/lib/turnFormat";
import { listGuildMembers } from "@/lib/discordGuild";
import { antagonistNames } from "@/lib/antagonists";
import { updateGameConfig, updateCurrentTurn, updateNextTurn, runDoctorAction, bulkMoveCharacters } from "./actions";
import EndTurnButton from "./EndTurnButton";
import WipeGameButton from "./WipeGameButton";
import AntagonistRosterButton from "./AntagonistRosterButton";
import PageShell, { PageHeader } from "@/app/components/PageShell";
import Switch from "@/app/components/Switch";
import Select from "@/app/components/Select";

const WEATHER_OPTIONS = [
  { value: "CLEAR", label: "Clear" },
  { value: "FOG", label: "Fog" },
  { value: "RAIN", label: "Rain" },
  { value: "STORM", label: "Storm" },
];

export default async function DevPanelPage() {
  const session = await auth();
  if (!session?.discordUserId) redirect("/");
  if (!isSuperadmin(session.discordUserId)) redirect("/character");

  const [config, openTurnRecord, lastTurn, reports, zones, livingCharacters, antagonistCharacters, tags, members] =
    await Promise.all([
      prisma.gameConfig.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } }),
      getOpenTurn(),
      prisma.turn.findFirst({ orderBy: { number: "desc" } }),
      // Latest report per kind — the section renders what actually happened,
      // instead of the fake success the wipe used to claim.
      prisma.systemReport.findMany({ orderBy: { createdAt: "desc" }, take: 30 }),
      prisma.zone.findMany({
        where: { kind: { not: "CAVE_GROUP" } },
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
        select: { id: true, name: true },
      }),
      prisma.character.findMany({
        where: { status: "ALIVE" },
        orderBy: { name: "asc" },
        select: { id: true, name: true, zone: { select: { name: true } } },
      }),
      // Written once at creation, never edited — see the antagonistOptIns
      // comment on the Character model. Nothing else in the app reads this,
      // so this popup is the only place a GM can see who wants a seat.
      prisma.character.findMany({
        where: { antagonistOptIns: { isEmpty: false } },
        orderBy: { name: "asc" },
        select: { id: true, name: true, discordUserId: true, antagonistOptIns: true },
      }),
      // Same shape as /gm/players' bulk-tag catalog — the popup's per-row
      // grant reuses that picker.
      prisma.tag.findMany({
        orderBy: [{ category: "asc" }, { name: "asc" }],
        select: {
          id: true,
          name: true,
          category: true,
          description: true,
          pointCost: true,
          parentTagId: true,
          group: { select: { name: true } },
        },
      }),
      listGuildMembers(),
    ]);

  const memberById = new Map(members.map((m) => [m.id, m]));
  const antagonistRoster = antagonistCharacters.map((c) => ({
    id: c.id,
    name: c.name,
    username: memberById.get(c.discordUserId)?.username ?? "",
    globalName: memberById.get(c.discordUserId)?.globalName ?? "",
    roleNames: antagonistNames(c.antagonistOptIns),
  }));

  const latestByKind = new Map();
  for (const report of reports) {
    if (!latestByKind.has(report.kind)) latestByKind.set(report.kind, report);
  }

  const currentDay = openTurnRecord ? Math.ceil(openTurnRecord.number / 2) : Math.ceil(((lastTurn?.number ?? 0) + 1) / 2);
  const currentPhase = openTurnRecord?.phase ?? (lastTurn?.phase === "DAWN" ? "DUSK" : "DAWN");
  const currentWeather = openTurnRecord?.weather ?? "CLEAR";

  // Mirrors advanceTurn()'s own phase alternation, so the confirm dialog can
  // warn about the Dawn wipe only when the next turn actually triggers one.
  const lastForPhase = openTurnRecord ?? lastTurn;
  const nextPhase = !lastForPhase || lastForPhase.phase === "DUSK" ? "DAWN" : "DUSK";

  return (
    <PageShell>
      <PageHeader
        title="Dev Panel"
        subtitle="Superadmin only. Edits here bypass all game rules — use with care."
        actions={
          <nav className="flex items-center gap-4 text-sm">
            <Link href="/gm/dev/characters" className="menu-item">Characters</Link>
            <Link href="/gm/dev/factions" className="menu-item">Factions</Link>
            <Link href="/gm/dev/tags" className="menu-item">Tags</Link>
            <Link href="/gm/gamemasters" className="menu-item">Gamemasters</Link>
            <AntagonistRosterButton characters={antagonistRoster} tags={tags} />
          </nav>
        }
      />

      <section className="panel p-4">
        <h2 className="panel-header">Current Turn</h2>
        <p className="mb-3 text-sm text-muted">
          {openTurnRecord ? `${describeTurn(openTurnRecord).label} — OPEN` : "No turn is currently open."}
        </p>

        <form action={updateCurrentTurn} className="flex flex-wrap items-end gap-3">
          <label className="field">
            <span className="field-label">Day</span>
            <input type="number" name="day" min="1" defaultValue={currentDay} style={{ maxWidth: "6rem" }} />
          </label>
          <label className="field">
            <span className="field-label">Phase</span>
            <Select name="phase" defaultValue={currentPhase}>
              <option value="DAWN">DAWN</option>
              <option value="DUSK">DUSK</option>
            </Select>
          </label>
          <label className="field">
            <span className="field-label">Weather</span>
            <Select name="weather" defaultValue={currentWeather}>
              {WEATHER_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </Select>
          </label>
          <SubmitButton pendingLabel="Saving…">Save</SubmitButton>
        </form>

        <EndTurnButton
          turnLabel={openTurnRecord ? describeTurn(openTurnRecord).label : null}
          wipesMessages={nextPhase === "DAWN" && config.messageWipeEnabled}
        />

        <p className="mt-3 text-xs text-muted">
          Save overrides the current turn&apos;s day/phase/weather directly.
        </p>
      </section>

      <section className="panel p-4">
        <h2 className="panel-header">Next Turn</h2>
        <p className="mb-3 text-sm text-muted">
          {config.nextWeather ? `Weather set to ${config.nextWeather}` : "Weather will be rolled automatically."}
          {config.nextTurnNote ? ` — note: "${config.nextTurnNote}"` : ""}
        </p>
        <form action={updateNextTurn} className="flex flex-col gap-3">
          <label className="field">
            <span className="field-label">Weather</span>
            <Select name="weather" defaultValue={config.nextWeather ?? ""} style={{ maxWidth: "12rem" }}>
              <option value="">Random</option>
              {WEATHER_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </Select>
          </label>
          <label className="field">
            <span className="field-label">Note (optional)</span>
            <textarea name="note" defaultValue={config.nextTurnNote ?? ""} rows={2} />
          </label>
          <SubmitButton className="btn self-start" pendingLabel="Saving…">Save</SubmitButton>
        </form>
        <p className="mt-3 text-xs text-muted">
          Applies on next turn (via End turn above or the bot&apos;s automatic dawn/dusk cron).
        </p>
      </section>

      <section className="panel p-4">
        <h2 className="panel-header">Game Config</h2>
        <form action={updateGameConfig} className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3">
          <label className="field">
            <span className="field-label">Lifeweb Blood (0-100, raw override)</span>
            <input type="number" name="lifewebBlood" min="0" max="100" defaultValue={config.lifewebBlood} />
          </label>
          <label className="field">
            <span className="field-label">Lifeweb decay / turn</span>
            <input type="number" name="lifewebDecayPerTurn" defaultValue={config.lifewebDecayPerTurn} />
          </label>
          <label className="field">
            <span className="field-label">Production coefficient</span>
            <input type="number" step="0.05" name="productionCoefficient" defaultValue={config.productionCoefficient} />
          </label>
          <label className="field">
            <span className="field-label">Starting tag points</span>
            <input type="number" name="startingTagPoints" min="0" defaultValue={config.startingTagPoints} />
          </label>
          <label className="field">
            <span className="field-label">Player count</span>
            <input type="number" name="playerCount" min="1" defaultValue={config.playerCount} />
          </label>

          <label className="field">
            <span className="field-label">Equip slots</span>
            <input type="number" name="equipSlots" min="1" max="20" defaultValue={config.equipSlots} />
          </label>
          <label className="field">
            <span className="field-label">Max drawbacks</span>
            <input
              type="number"
              name="maxNegativeTags"
              min="0"
              max="20"
              defaultValue={config.maxNegativeTags}
            />
          </label>
          <Switch name="openToPlayers" defaultChecked={config.openToPlayers} className="col-span-full">
            Open to players
          </Switch>
          <Switch name="leaderWhitelistEnabled" defaultChecked={config.leaderWhitelistEnabled} className="col-span-full">
            Require the @Leader Whitelist role to pick a Leader (★) role
          </Switch>
          <Switch name="playtestModeEnabled" defaultChecked={config.playtestModeEnabled} className="col-span-full">
            Playtest mode — lock the Merchant and every Windlands role out of character creation. Their cards still show, greyed, so the charters stay readable. Not bypassed for superadmins.
          </Switch>
          <Switch name="autoTurnAdvanceDisabled" defaultChecked={config.autoTurnAdvanceDisabled} className="col-span-full">
            Pause automatic turn advance — the twice-daily cron skips its advance while this is on. &ldquo;Advance turn now&rdquo; below still works.
          </Switch>
          <Switch name="avatarUploadsEnabled" defaultChecked={config.avatarUploadsEnabled} className="col-span-full">
            Allow players to upload their own profile picture
          </Switch>
          <Switch name="portraitMakerEnabled" defaultChecked={config.portraitMakerEnabled} className="col-span-full">
            Show the &quot;Customize Appearance&quot; portrait maker on /character
          </Switch>
          <Switch name="portraitFantasyPartsEnabled" defaultChecked={config.portraitFantasyPartsEnabled} className="col-span-full">
            Allow the portrait maker&apos;s fantasy parts.
          </Switch>
          <Switch name="messageWipeEnabled" defaultChecked={config.messageWipeEnabled} className="col-span-full">
            Wipe messages at Dawn — the transcript is already recorded at send time, this only deletes (see docs/systemdocs/CHANNELS.md)
          </Switch>
          <label className="field">
            <span className="field-label">Idle turns before a character goes Catatonic (AFK)</span>
            <input
              type="number"
              name="catatonicTurns"
              min="1"
              max="60"
              defaultValue={config.catatonicTurns}
            />
          </label>
          <Switch name="catatonicEnabled" defaultChecked={config.catatonicEnabled} className="col-span-full">
            Flag a character Catatonic (AFK) after that many turns with no move filed and nothing said in character — clears the moment they act or speak again.
          </Switch>
          <Switch name="autoReconcileEnabled" defaultChecked={config.autoReconcileEnabled} className="col-span-full">
            Run the channel doctor&apos;s cheap reconcile (roles vs. the database) automatically after every turn advance — it always runs when the bot restarts.
          </Switch>
          <Switch name="tupperAutocorrectEnabled" defaultChecked={config.tupperAutocorrectEnabled} className="col-span-full">
            Capitalize sentence starts in Tupper messages before proxying
          </Switch>
          <Switch name="nicknameSyncEnabled" defaultChecked={config.nicknameSyncEnabled} className="col-span-full">
            Sync Discord nicknames to &quot;{"{base}"} | Character Name&quot; on profile/character changes
          </Switch>
          <Switch name="archiveVisible" defaultChecked={config.archiveVisible} className="col-span-full">
            Open /archive to players — <strong>effectively one-way</strong>: shows every location regardless of where a character stood, and names the character behind every /conceal. Meant for after the game ends.
          </Switch>
          <Switch name="archiveTravelEvents" defaultChecked={config.archiveTravelEvents} className="col-span-full">
            Record arrivals/departures in the archive
          </Switch>
          <div className="col-span-full">
            <SubmitButton pendingLabel="Saving…">Save config</SubmitButton>
          </div>
        </form>
      </section>

      <section className="panel p-4">
        <h2 className="panel-header">Bulk Move</h2>
        <p className="mb-3 text-sm text-muted">
          Relocate several characters to one zone at once. A raw move — no Move cost, no adjacency
          check. Their zone roles resync in the background; the report lands under System Reports.
        </p>
        <form action={bulkMoveCharacters} className="flex flex-wrap items-end gap-3">
          <label className="field">
            <span className="field-label">Characters (ctrl/cmd-click for several)</span>
            <select name="characterIds" multiple size={8} style={{ minWidth: "18rem" }}>
              {livingCharacters.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.zone ? ` — ${c.zone.name}` : ""}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="field-label">Zone</span>
            <Select name="zoneId">
              {zones.map((z) => (
                <option key={z.id} value={z.id}>{z.name}</option>
              ))}
            </Select>
          </label>
          <SubmitButton pendingLabel="Moving…">Move them</SubmitButton>
        </form>
      </section>

      <section className="panel p-4">
        <h2 className="panel-header">System Reports</h2>
        <p className="mb-3 text-sm text-muted">
          The last run of each operational pass. A report without a finish time means the container
          died mid-pass — re-run the pass or the doctor. Failures listed here are live problems,
          not history.
        </p>
        <div className="mb-4 flex flex-wrap gap-2">
          <form action={runDoctorAction}>
            <input type="hidden" name="mode" value="check" />
            <input type="hidden" name="scope" value="full" />
            <SubmitButton className="btn" pendingLabel="Starting…">Run channel doctor (dry)</SubmitButton>
          </form>
          <form action={runDoctorAction}>
            <input type="hidden" name="mode" value="repair" />
            <input type="hidden" name="scope" value="full" />
            <SubmitButton className="btn" pendingLabel="Starting…">Repair</SubmitButton>
          </form>
        </div>
        <div className="flex flex-col gap-3">
          {[...latestByKind.values()].map((report) => (
            <div key={report.id} className="rounded border p-3 text-sm">
              <div className="flex flex-wrap items-baseline gap-2">
                <strong>{report.kind}</strong>
                <span className={report.finishedAt ? (report.ok ? "text-muted" : "text-accent") : "text-accent"}>
                  {report.finishedAt ? (report.ok ? "clean" : "issues") : "unfinished"}
                </span>
                <span className="mono text-xs text-muted">
                  {report.startedAt.toISOString().slice(0, 16).replace("T", " ")}
                </span>
              </div>
              {report.summary && Object.keys(report.summary).length > 0 ? (
                <p className="mt-1 text-xs text-muted mono">{JSON.stringify(report.summary)}</p>
              ) : null}
              {Array.isArray(report.failures) && report.failures.length > 0 ? (
                <ul className="mt-2 list-disc pl-5 text-xs">
                  {report.failures.slice(0, 25).map((f, i) => (
                    <li key={i}>
                      {[f.check ?? f.step, f.target].filter(Boolean).join(" · ")}: {f.message}
                    </li>
                  ))}
                  {report.failures.length > 25 ? (
                    <li className="text-muted">…and {report.failures.length - 25} more.</li>
                  ) : null}
                </ul>
              ) : null}
            </div>
          ))}
          {latestByKind.size === 0 ? (
            <p className="text-sm text-muted">Nothing has reported yet.</p>
          ) : null}
        </div>
      </section>

      <section className="panel p-4" style={{ borderColor: "var(--accent)" }}>
        <h2 className="panel-header text-accent">Restart Game</h2>
        <p className="mb-3 text-sm text-muted">
          Wipes all game data and reopens Turn 1. Cannot be undone.
        </p>
        <WipeGameButton />
      </section>
    </PageShell>
  );
}
