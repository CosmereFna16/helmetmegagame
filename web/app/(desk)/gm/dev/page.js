import SubmitButton from "@/app/components/SubmitButton";
import { redirect } from "next/navigation";
import { prisma } from "@lifeweb/db";
import { auth } from "@/lib/auth";
import { isSuperadmin } from "@/lib/superadmin";
import { getOpenTurn } from "@/lib/turn";
import { describeTurn } from "@/lib/turnFormat";
import { listGuildMembers } from "@/lib/discordGuild";
import { antagonistNames } from "@/lib/antagonists";
import {
  updateGameConfig,
  updateCurrentTurn,
  updateNextTurn,
  runDoctorAction,
  bulkMoveCharacters,
} from "@/app/(app)/gm/dev/actions";
import EndTurnButton from "@/app/(app)/gm/dev/EndTurnButton";
import WipeGameButton from "@/app/(app)/gm/dev/WipeGameButton";
import AntagonistRosterButton from "@/app/(app)/gm/dev/AntagonistRosterButton";
import { CONFIG_HELP } from "@/app/(app)/gm/dev/devHelp";
import DeskHeader from "@/app/components/DeskHeader";
import OpsNav from "./OpsNav";
import Switch from "@/app/components/Switch";
import InfoIcon from "@/app/components/InfoIcon";
import Select from "@/app/components/Select";
import StatusPill from "@/app/components/StatusPill";
import EmptyState from "@/app/components/EmptyState";

const WEATHER_OPTIONS = [
  { value: "CLEAR", label: "Clear" },
  { value: "FOG", label: "Fog" },
  { value: "RAIN", label: "Rain" },
  { value: "STORM", label: "Storm" },
];

const SECTIONS = new Set(["turn", "config", "move", "reports", "antagonists", "danger"]);

// A report's per-step breakdown is the useful half but far too long to dump
// inline, so the JSON line drops it and the five slowest steps get their own
// rows. That is how the Dawn wipe says which zone ate the hour.
function summaryHead(summary) {
  const { steps, ...rest } = summary ?? {};
  return rest;
}

function slowestSteps(summary) {
  const steps = summary?.steps;
  if (!Array.isArray(steps) || steps.length === 0 || typeof steps[0] !== "object") return [];
  return [...steps].sort((a, b) => (b.elapsedMs ?? 0) - (a.elapsedMs ?? 0)).slice(0, 5);
}

function reportTone(report) {
  if (!report.finishedAt) return "warn";
  return report.ok ? "good" : "bad";
}

function reportLabel(report) {
  if (!report.finishedAt) return "unfinished";
  return report.ok ? "clean" : "issues";
}

export default async function DevPanelPage({ searchParams }) {
  const session = await auth();
  if (!session?.discordUserId) redirect("/");
  if (!isSuperadmin(session.discordUserId)) redirect("/character");

  const { s } = await searchParams;
  const section = SECTIONS.has(s) ? s : "turn";

  // Always fetched: the header needs the open turn regardless of section,
  // and the turn section derives day/phase/weather from the same rows.
  const [config, openTurnRecord, lastTurn] = await Promise.all([
    prisma.gameConfig.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } }),
    getOpenTurn(),
    prisma.turn.findFirst({ orderBy: { number: "desc" } }),
  ]);

  const currentDay = openTurnRecord ? Math.ceil(openTurnRecord.number / 2) : Math.ceil(((lastTurn?.number ?? 0) + 1) / 2);
  const currentPhase = openTurnRecord?.phase ?? (lastTurn?.phase === "DAWN" ? "DUSK" : "DAWN");
  const currentWeather = openTurnRecord?.weather ?? "CLEAR";

  // Mirrors advanceTurn()'s own phase alternation, so the confirm dialog can
  // warn about the Dawn wipe only when the next turn actually triggers one.
  const lastForPhase = openTurnRecord ?? lastTurn;
  const nextPhase = !lastForPhase || lastForPhase.phase === "DUSK" ? "DAWN" : "DUSK";

  let locations = [];
  let livingCharacters = [];
  let latestByKind = new Map();
  let antagonistRoster = [];
  let tags = [];

  switch (section) {
    case "move":
      [locations, livingCharacters] = await Promise.all([
        prisma.location.findMany({
          orderBy: [{ zone: { sortOrder: "asc" } }, { sortOrder: "asc" }],
          select: { id: true, name: true, zoneId: true, zone: { select: { name: true } } },
        }),
        prisma.character.findMany({
          where: { status: "ALIVE" },
          orderBy: { name: "asc" },
          select: { id: true, name: true, location: { select: { name: true } } },
        }),
      ]);
      break;
    case "reports": {
      // Latest report per kind — the section renders what actually happened,
      // instead of the fake success the wipe used to claim.
      const reports = await prisma.systemReport.findMany({ orderBy: { createdAt: "desc" }, take: 30 });
      for (const report of reports) {
        if (!latestByKind.has(report.kind)) latestByKind.set(report.kind, report);
      }
      break;
    }
    case "antagonists": {
      const [antagonistCharacters, tagRows, members] = await Promise.all([
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
      tags = tagRows;
      const memberById = new Map(members.map((m) => [m.id, m]));
      antagonistRoster = antagonistCharacters.map((c) => ({
        id: c.id,
        name: c.name,
        username: memberById.get(c.discordUserId)?.username ?? "",
        globalName: memberById.get(c.discordUserId)?.globalName ?? "",
        roleNames: antagonistNames(c.antagonistOptIns),
      }));
      break;
    }
    default:
      break;
  }

  return (
    <div className="desk-shell">
      <DeskHeader
        title="Dev Panel"
        meta={
          <span className="chip">
            {openTurnRecord ? `${describeTurn(openTurnRecord).label} — OPEN` : "No open turn"}
          </span>
        }
        actions={<span className="text-xs text-muted">Superadmin — edits here bypass every game rule</span>}
      />
      <div className="desk-body desk-body--ops">
        <OpsNav section={section} />
        <main className="ops-main">
          {section === "turn" ? (
            <div className="flex flex-col gap-8">
              <section className="ops-section">
                <div className="ops-section-head">
                  <h2 className="section-title">Current Turn</h2>
                  <p className="ops-lede">
                    {openTurnRecord ? `${describeTurn(openTurnRecord).label} — OPEN` : "No turn is currently open."}
                  </p>
                </div>

                <form action={updateCurrentTurn} className="flex flex-wrap items-end gap-3">
                  <label className="field">
                    <span className="field-label">Day</span>
                    <input type="number" name="day" min="1" defaultValue={currentDay} className="max-w-24" />
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

                <p className="ops-lede">
                  Save overrides the current turn&apos;s day/phase/weather directly.
                </p>
              </section>

              <section className="ops-section">
                <div className="ops-section-head">
                  <h2 className="section-title">Next Turn</h2>
                  <p className="ops-lede">
                    {config.nextWeather ? `Weather set to ${config.nextWeather}` : "Weather will be rolled automatically."}
                    {config.nextTurnNote ? ` — note: "${config.nextTurnNote}"` : ""}
                  </p>
                </div>
                <form action={updateNextTurn} className="flex flex-col gap-3">
                  <label className="field">
                    <span className="field-label">Weather</span>
                    <Select name="weather" defaultValue={config.nextWeather ?? ""} className="max-w-48">
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
                  <div className="ops-actions">
                    <SubmitButton pendingLabel="Saving…">Save</SubmitButton>
                  </div>
                </form>
                <p className="ops-lede">
                  Applies on next turn (via End turn above or the bot&apos;s automatic dawn/dusk cron).
                </p>
              </section>
            </div>
          ) : null}

          {section === "config" ? (
            <section className="ops-section">
              <div className="ops-section-head">
                <h2 className="section-title">Game Config</h2>
              </div>
              <form action={updateGameConfig} className="flex flex-col gap-4">
                <div className="ops-grid">
                  <div className="field">
                    <span className="flex items-center gap-2">
                      <label htmlFor="config-lifewebBlood" className="field-label">
                        Lifeweb Blood
                      </label>
                      <InfoIcon text={CONFIG_HELP.lifewebBlood} />
                    </span>
                    <input
                      type="number"
                      id="config-lifewebBlood"
                      name="lifewebBlood"
                      min="0"
                      max="100"
                      defaultValue={config.lifewebBlood}
                    />
                  </div>
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
                    <span className="field-label panel-header--with-icon">
                      Carry cap: lb ‡
                      <InfoIcon text={CONFIG_HELP.carryWeightLbs} />
                    </span>
                    <input type="number" name="carryWeightLbs" min="1" defaultValue={config.carryWeightLbs} />
                  </label>
                  <label className="field">
                    <span className="field-label panel-header--with-icon">
                      Carry cap: ⬢ ‡
                      <InfoIcon text={CONFIG_HELP.carryResourceCap} />
                    </span>
                    <input type="number" name="carryResourceCap" min="1" defaultValue={config.carryResourceCap} />
                  </label>
                  <label className="field">
                    <span className="field-label panel-header--with-icon">
                      Free zone moves ‡
                      <InfoIcon text={CONFIG_HELP.freeZoneMovesPerTurn} />
                    </span>
                    <input
                      type="number"
                      name="freeZoneMovesPerTurn"
                      min="0"
                      max="5"
                      defaultValue={config.freeZoneMovesPerTurn}
                    />
                  </label>
                  <label className="field">
                    <span className="field-label panel-header--with-icon">
                      Desire slots
                      <InfoIcon text={CONFIG_HELP.desireSlots} />
                    </span>
                    <input type="number" name="desireSlots" min="1" max="5" defaultValue={config.desireSlots} />
                  </label>
                  <label className="field">
                    <span className="field-label panel-header--with-icon">
                      Desire slot lock
                      <InfoIcon text={CONFIG_HELP.desireSlotLockTurns} />
                    </span>
                    <input
                      type="number"
                      name="desireSlotLockTurns"
                      min="0"
                      max="20"
                      defaultValue={config.desireSlotLockTurns}
                    />
                  </label>
                  <label className="field">
                    <span className="field-label">Max drawback tags</span>
                    <input type="number" name="maxDrawbackTags" min="0" max="20" defaultValue={config.maxDrawbackTags} />
                  </label>
                  <label className="field">
                    <span className="field-label">Catatonic after N idle turns</span>
                    <input type="number" name="catatonicTurns" min="1" max="60" defaultValue={config.catatonicTurns} />
                  </label>
                  <label className="field">
                    <span className="field-label">Death after N Catatonic turns (0 = off)</span>
                    <input type="number" name="catatonicDeathTurns" min="0" max="60" defaultValue={config.catatonicDeathTurns} />
                  </label>
                  <label className="field">
                    <span className="field-label">
                      Walk cooldown (seconds) ‡
                      <InfoIcon text={CONFIG_HELP.locationMoveCooldownSeconds} />
                    </span>
                    <input
                      type="number"
                      name="locationMoveCooldownSeconds"
                      min="0"
                      max="3600"
                      defaultValue={config.locationMoveCooldownSeconds}
                    />
                  </label>
                </div>

                <div className="ops-toggles">
                  <div className="ops-toggle">
                    <Switch name="openToPlayers" defaultChecked={config.openToPlayers}>Open to players</Switch>
                  </div>
                  <div className="ops-toggle">
                    <Switch name="leaderWhitelistEnabled" defaultChecked={config.leaderWhitelistEnabled}>
                      Require Leader Whitelist for ★ roles
                    </Switch>
                    <InfoIcon text={CONFIG_HELP.leaderWhitelistEnabled} />
                  </div>
                  <div className="ops-toggle">
                    <Switch name="playtestModeEnabled" defaultChecked={config.playtestModeEnabled}>
                      Playtest mode
                    </Switch>
                    <InfoIcon text={CONFIG_HELP.playtestModeEnabled} />
                  </div>
                  <div className="ops-toggle">
                    <div className="flex flex-1 min-w-0 flex-col gap-1">
                      <div className="flex items-center gap-3">
                        <Switch name="autoTurnAdvanceDisabled" defaultChecked={config.autoTurnAdvanceDisabled}>
                          Pause automatic turn advance
                        </Switch>
                        <InfoIcon text={CONFIG_HELP.autoTurnAdvanceDisabled} />
                      </div>
                      <p className="ops-toggle-note">&ldquo;Advance turn now&rdquo; on the Turn section still works.</p>
                    </div>
                  </div>
                  <div className="ops-toggle">
                    <Switch name="avatarUploadsEnabled" defaultChecked={config.avatarUploadsEnabled}>
                      Player avatar uploads
                    </Switch>
                    <InfoIcon text={CONFIG_HELP.avatarUploadsEnabled} />
                  </div>
                  <div className="ops-toggle">
                    <Switch name="portraitMakerEnabled" defaultChecked={config.portraitMakerEnabled}>
                      Portrait maker
                    </Switch>
                    <InfoIcon text={CONFIG_HELP.portraitMakerEnabled} />
                  </div>
                  <div className="ops-toggle">
                    <Switch name="portraitFantasyPartsEnabled" defaultChecked={config.portraitFantasyPartsEnabled}>
                      Portrait fantasy parts
                    </Switch>
                    <InfoIcon text={CONFIG_HELP.portraitFantasyPartsEnabled} />
                  </div>
                  <div className="ops-toggle">
                    <Switch name="messageWipeEnabled" defaultChecked={config.messageWipeEnabled}>
                      Wipe messages at Dawn
                    </Switch>
                    <InfoIcon text={CONFIG_HELP.messageWipeEnabled} />
                  </div>
                  <div className="ops-toggle">
                    <Switch name="catatonicEnabled" defaultChecked={config.catatonicEnabled}>
                      Catatonic (AFK) flagging
                    </Switch>
                    <InfoIcon text={CONFIG_HELP.catatonicEnabled} />
                  </div>
                  <div className="ops-toggle">
                    <Switch name="desiresEnabled" defaultChecked={config.desiresEnabled}>
                      Desire system
                    </Switch>
                    <InfoIcon text={CONFIG_HELP.desiresEnabled} />
                  </div>
                  <div className="ops-toggle">
                    <Switch name="autoReconcileEnabled" defaultChecked={config.autoReconcileEnabled}>
                      Auto-reconcile after turn advance
                    </Switch>
                    <InfoIcon text={CONFIG_HELP.autoReconcileEnabled} />
                  </div>
                  <div className="ops-toggle">
                    <Switch name="tupperAutocorrectEnabled" defaultChecked={config.tupperAutocorrectEnabled}>
                      Tupper autocorrect
                    </Switch>
                    <InfoIcon text={CONFIG_HELP.tupperAutocorrectEnabled} />
                  </div>
                  <div className="ops-toggle">
                    <Switch name="nicknameSyncEnabled" defaultChecked={config.nicknameSyncEnabled}>
                      Nickname sync
                    </Switch>
                    <InfoIcon text={CONFIG_HELP.nicknameSyncEnabled} />
                  </div>
                  <div className="ops-toggle">
                    <div className="flex flex-1 min-w-0 flex-col gap-1">
                      <div className="flex items-center gap-3">
                        <Switch name="archiveVisible" defaultChecked={config.archiveVisible}>
                          Open /archive to players
                        </Switch>
                        <InfoIcon text={CONFIG_HELP.archiveVisible} />
                      </div>
                      <p className="ops-toggle-note">Effectively one-way — meant for after the game ends.</p>
                    </div>
                  </div>
                  <div className="ops-toggle">
                    <Switch name="archiveTravelEvents" defaultChecked={config.archiveTravelEvents}>
                      Archive travel events
                    </Switch>
                    <InfoIcon text={CONFIG_HELP.archiveTravelEvents} />
                  </div>
                </div>

                <div className="ops-actions">
                  <SubmitButton pendingLabel="Saving…">Save config</SubmitButton>
                </div>
              </form>
            </section>
          ) : null}

          {section === "move" ? (
            <section className="ops-section">
              <div className="ops-section-head">
                <h2 className="section-title">Bulk Move</h2>
                <p className="ops-lede">
                  Relocate several characters to one location at once. A raw move — no Move
                  cost, no adjacency check, no walk cooldown. ‡
                </p>
              </div>
              <form action={bulkMoveCharacters} className="flex flex-wrap items-end gap-3">
                <label className="field">
                  <span className="field-label">Characters (ctrl/cmd-click for several)</span>
                  <select name="characterIds" multiple size={8} className="min-w-72">
                    {livingCharacters.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                        {c.location ? ` — ${c.location.name}` : ""}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span className="field-label">Location</span>
                  <Select name="locationId">
                    {groupLocationsByZone(locations).map((group) => (
                      <optgroup key={group.zoneId ?? "loose"} label={group.zoneName ?? "Unzoned ‡"}>
                        {group.locations.map((l) => (
                          <option key={l.id} value={l.id}>{l.name}</option>
                        ))}
                      </optgroup>
                    ))}
                  </Select>
                </label>
                <SubmitButton pendingLabel="Moving…">Move them</SubmitButton>
              </form>
              <p className="ops-lede">
                Their location and zone roles resync in the background; the report lands under
                System Reports. ‡
              </p>
            </section>
          ) : null}

          {section === "reports" ? (
            <section className="ops-section">
              <div className="ops-section-head">
                <h2 className="section-title">System Reports</h2>
                <p className="ops-lede">
                  The last run of each operational pass. A report without a finish time means the container
                  died mid-pass — re-run the pass or the doctor. Failures listed here are live problems,
                  not history.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <form action={runDoctorAction}>
                  <input type="hidden" name="mode" value="check" />
                  <input type="hidden" name="scope" value="full" />
                  <SubmitButton className="btn-secondary" pendingLabel="Starting…">Run channel doctor (dry)</SubmitButton>
                </form>
                <form action={runDoctorAction}>
                  <input type="hidden" name="mode" value="repair" />
                  <input type="hidden" name="scope" value="full" />
                  <SubmitButton className="btn-secondary" pendingLabel="Starting…">Repair</SubmitButton>
                </form>
              </div>
              <div>
                {[...latestByKind.values()].map((report) => (
                  <div key={report.id} className="ops-report">
                    <div className="ops-report-head">
                      <strong>{report.kind}</strong>
                      <StatusPill tone={reportTone(report)}>{reportLabel(report)}</StatusPill>
                      <span className="mono text-xs text-muted">
                        {report.startedAt.toISOString().slice(0, 16).replace("T", " ")}
                      </span>
                    </div>
                    {report.summary && Object.keys(report.summary).length > 0 ? (
                      <p className="ops-report-detail mono">{JSON.stringify(summaryHead(report.summary))}</p>
                    ) : null}
                    {slowestSteps(report.summary).length > 0 ? (
                      <ul className="ops-report-detail mono">
                        {slowestSteps(report.summary).map((step) => (
                          <li key={step.name}>
                            {Math.round(step.elapsedMs / 1000)}s · {step.requests} req · {step.name}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                    {Array.isArray(report.failures) && report.failures.length > 0 ? (
                      <ul className="text-xs list-disc pl-5">
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
                {latestByKind.size === 0 ? <EmptyState>Nothing has reported yet.</EmptyState> : null}
              </div>
            </section>
          ) : null}

          {section === "antagonists" ? (
            <section className="ops-section">
              <div className="ops-section-head">
                <h2 className="section-title">Antagonist Roster</h2>
                <p className="ops-lede">
                  Who opted into an antagonist seat at creation — the only place this is visible.
                </p>
              </div>
              <AntagonistRosterButton characters={antagonistRoster} tags={tags} />
            </section>
          ) : null}

          {section === "danger" ? (
            <section className="ops-section">
              <div className="desk-card panel-danger flex flex-col gap-3">
                <h2 className="section-title">Restart Game</h2>
                <p className="ops-lede">Wipes all game data and reopens Turn 1. Cannot be undone.</p>
                <WipeGameButton />
              </div>
            </section>
          ) : null}
        </main>
      </div>
    </div>
  );
}


// Locations arrive ordered by zone then sortOrder, so one pass builds the
// <optgroup> list in docs/zones.yaml order.
function groupLocationsByZone(locations) {
  const groups = [];
  for (const l of locations ?? []) {
    const last = groups[groups.length - 1];
    if (last && last.zoneId === l.zoneId) last.locations.push(l);
    else groups.push({ zoneId: l.zoneId, zoneName: l.zone?.name ?? null, locations: [l] });
  }
  return groups;
}
