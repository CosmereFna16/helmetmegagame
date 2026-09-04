import SubmitButton from "@/app/components/SubmitButton";
import { redirect } from "next/navigation";
import { prisma, loadDepot, turretTable } from "@lifeweb/db";
import { auth } from "@/lib/auth";
import { isSuperadmin } from "@/lib/superadmin";
import { getOpenTurn } from "@/lib/turn";
import { describeTurn } from "@/lib/turnFormat";
import { listGuildMembers } from "@/lib/discordGuild";
import { OPT_IN_THREATS, ASSIGNABLE_THREATS, SEAT_TAG_SLUGS, antagonistNames, threatBySeatTag, threatBySlug } from "@/lib/threats";
import { PLAYER_ROLE_ID } from "@lifeweb/db/lib/roleIds";
import { roleCapacity, seatHolderStatuses } from "@lifeweb/db/lib/roleCapacity";
import {
  updateGameConfig,
  updateDepot,
  updateCurrentTurn,
  updateNextTurn,
  runDoctorAction,
  bulkMoveCharacters,
} from "@/app/(app)/gm/dev/actions";
import EndTurnButton from "@/app/(app)/gm/dev/EndTurnButton";
import WipeGameButton from "@/app/(app)/gm/dev/WipeGameButton";
import ThreatAssignmentsTable from "@/app/(app)/gm/dev/threats/ThreatAssignmentsTable";
import ThreatRosterTable from "@/app/(app)/gm/dev/threats/ThreatRosterTable";
import { CONFIG_HELP, DEPOT_HELP } from "@/app/(app)/gm/dev/devHelp";
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

// Eight numeric Depot knobs share one shape, so they share one component
// rather than eight copies of the same six lines.
function DepotField({ name, label, value, help }) {
  return (
    <div className="field">
      <span className="flex items-center gap-2">
        <label htmlFor={`depot-${name}`} className="field-label">
          {label}
        </label>
        <InfoIcon text={help} />
      </span>
      <input type="number" id={`depot-${name}`} name={name} min="0" defaultValue={value} />
    </div>
  );
}

// The catalog as the two tables need it. Flattened here rather than passed
// whole: a client component gets plain data, and the blurbs belong in the DM
// rather than in a table's props.
// The union of both, not just the opt-ins: a seat can be assignable without
// ever having been a checkbox (the Tribunal will be), and the table needs it
// in the Assign dropdown regardless.
const THREAT_SUMMARY = [...new Set([...OPT_IN_THREATS, ...ASSIGNABLE_THREATS])].map((t) => ({
  slug: t.slug,
  name: t.name,
  optIn: Boolean(t.optIn),
  assignable: Boolean(t.assignable),
  tagPoints: t.assign?.tagPoints ?? 0,
  spawnRoleSlug: t.spawn?.roleSlug ?? null,
}));
const ASSIGNABLE_SUMMARY = ASSIGNABLE_THREATS.map((t) => ({ slug: t.slug, name: t.name }));

const SECTIONS = new Set(["turn", "config", "depot", "move", "reports", "assignments", "antagonists", "danger"]);

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
  const [config, openTurnRecord, lastTurn, depot] = await Promise.all([
    prisma.gameConfig.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } }),
    getOpenTurn(),
    prisma.turn.findFirst({ orderBy: { number: "desc" } }),
    loadDepot(prisma),
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
  // The two threat sections. Each fetches only its own data, same as every
  // other section here.
  let assignmentRows = [];
  let spawnRoles = [];
  let spawnLocations = [];
  let seatRows = [];
  let pendingSpawns = [];

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
    case "assignments": {
      // Rows are every APPROVED PLAYER in the guild, not every character:
      // a SPAWN is aimed precisely at the people who are not in the game, so
      // a player with no character is a real row rather than a gap.
      const [members, characters, roles, locationRows] = await Promise.all([
        listGuildMembers(),
        // ALIVE only: Catatonic is a TAG on a living character, not a status,
        // and a dead one is not somebody you hand a seat to.
        prisma.character.findMany({
          where: { status: "ALIVE" },
          orderBy: { name: "asc" },
          select: {
            id: true,
            name: true,
            discordUserId: true,
            status: true,
            roleTitle: true,
            antagonistOptIns: true,
            zone: { select: { name: true } },
            tags: { select: { tag: { select: { slug: true } } } },
          },
        }),
        prisma.role.findMany({
          orderBy: [{ name: "asc" }],
          select: {
            id: true,
            slug: true,
            name: true,
            isUnique: true,
            unlimited: true,
            weight: true,
            startingLocationId: true,
          },
        }),
        prisma.location.findMany({
          orderBy: [{ zone: { sortOrder: "asc" } }, { sortOrder: "asc" }],
          select: { id: true, name: true, zone: { select: { name: true } } },
        }),
      ]);

      const byUser = new Map(characters.map((c) => [c.discordUserId, c]));
      assignmentRows = members
        .filter((m) => m.roles.includes(PLAYER_ROLE_ID))
        .map((m) => {
          const c = byUser.get(m.id) ?? null;
          // The seat is DERIVED from the held tag, so a GM who granted it by
          // hand from the character panel still shows up as holding it.
          const heldSlugs = new Set((c?.tags ?? []).map((t) => t.tag.slug));
          const seat = SEAT_TAG_SLUGS.map(threatBySeatTag).find((t) => t && heldSlugs.has(t.seatTagSlug));
          return {
            discordUserId: m.id,
            handle: m.globalName || m.username,
            characterId: c?.id ?? null,
            characterName: c?.name ?? null,
            roleTitle: c?.roleTitle ?? null,
            zoneName: c?.zone?.name ?? null,
            statusLabel: c ? c.status : "Not in game",
            optInNames: antagonistNames(c?.antagonistOptIns ?? []),
            seatName: seat?.name ?? null,
          };
        });

      // Seats left per role, so the spawn dialog says which are open rather
      // than letting an accept fail on a full one.
      const taken = await prisma.character.groupBy({
        by: ["roleId", "status"],
        _count: { _all: true },
      });
      spawnRoles = roles.map((role) => {
        const holders = seatHolderStatuses(role);
        const used = taken
          .filter((t) => t.roleId === role.id && holders.includes(t.status))
          .reduce((n, t) => n + t._count._all, 0);
        const cap = roleCapacity(role, config?.playerCount ?? 100);
        return {
          id: role.id,
          slug: role.slug,
          name: role.name,
          startingLocationId: role.startingLocationId,
          seatsLeft: cap === Infinity ? "\u221e" : Math.max(0, cap - used),
        };
      });

      spawnLocations = locationRows.map((l) => ({ id: l.id, name: l.name, zoneName: l.zone?.name ?? "" }));
      break;
    }
    case "antagonists": {
      const [heldSeats, offers, members] = await Promise.all([
        // Who holds a seat, read off the seat tag itself. No column to keep in
        // sync, and it stays right however the tag was granted.
        prisma.characterTag.findMany({
          where: { tag: { slug: { in: SEAT_TAG_SLUGS } } },
          select: {
            acquiredAt: true,
            tag: { select: { slug: true } },
            character: {
              select: {
                id: true,
                name: true,
                discordUserId: true,
                status: true,
                resources: true,
                tagPoints: true,
                location: { select: { name: true } },
                zone: { select: { name: true } },
              },
            },
          },
        }),
        prisma.threatSpawn.findMany({
          where: { status: "PENDING" },
          orderBy: { createdAt: "desc" },
          select: {
            id: true,
            discordUserId: true,
            threatSlug: true,
            createdAt: true,
            role: { select: { name: true } },
            location: { select: { name: true } },
          },
        }),
        listGuildMembers(),
      ]);

      const handleFor = new Map(members.map((m) => [m.id, m.globalName || m.username]));
      seatRows = heldSeats
        .map((row) => {
          const threat = threatBySeatTag(row.tag.slug);
          if (!threat || !row.character) return null;
          return {
            threatSlug: threat.slug,
            threatName: threat.name,
            characterId: row.character.id,
            characterName: row.character.name,
            handle: handleFor.get(row.character.discordUserId) ?? "left the guild",
            status: row.character.status,
            locationName: row.character.location?.name ?? null,
            zoneName: row.character.zone?.name ?? "",
            resources: row.character.resources,
            tagPoints: row.character.tagPoints,
            acquiredAt: row.acquiredAt.toISOString().slice(0, 10),
          };
        })
        .filter(Boolean);

      pendingSpawns = offers.map((o) => ({
        id: o.id,
        threatName: threatBySlug(o.threatSlug)?.name ?? o.threatSlug,
        handle: handleFor.get(o.discordUserId) ?? o.discordUserId,
        roleName: o.role?.name ?? "",
        locationName: o.location?.name ?? null,
        createdAt: o.createdAt.toISOString().slice(0, 16).replace("T", " "),
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
                  Applies on next turn (via End turn above or the bot&apos;s nightly cron).
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
                    {/* A positive magnitude: "at most this many points may be
                        claimed back". A build stops at whichever of the two
                        drawback ceilings it reaches first. */}
                    <span className="field-label">Max drawback points</span>
                    <input
                      type="number"
                      name="maxDrawbackPoints"
                      min="0"
                      max="60"
                      defaultValue={config.maxDrawbackPoints}
                    />
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

          {section === "depot" ? (
            <section className="ops-section">
              <div className="ops-section-head">
                <h2 className="section-title">The Depot</h2>
              </div>
              <p className="ops-lede">
                The Merchant&apos;s station. The top half is live state you can override; the bottom
                half is the tuning the game runs on. The turret&apos;s severity table is edited as JSON
                — every column has to sum to 1 or the save is refused. ‡
              </p>
              <form action={updateDepot} className="flex flex-col gap-4">
                <div className="ops-grid">
                  <DepotField
                    name="accountObols"
                    label="Account (¢)"
                    value={depot.accountObols}
                    help={DEPOT_HELP.accountObols}
                  />
                  <DepotField
                    name="debtObols"
                    label="Drawn on the line (¢)"
                    value={depot.debtObols}
                    help={DEPOT_HELP.debtObols}
                  />
                  <DepotField
                    name="generatorFuel"
                    label="Fuel in the tank"
                    value={depot.generatorFuel}
                    help={DEPOT_HELP.generatorFuel}
                  />
                  <div className="field">
                    <span className="flex items-center gap-2">
                      <label htmlFor="depot-merchantFace" className="field-label">
                        Face the turret spares
                      </label>
                      <InfoIcon text={DEPOT_HELP.merchantFace} />
                    </span>
                    <input
                      type="text"
                      id="depot-merchantFace"
                      name="merchantFace"
                      defaultValue={depot.merchantFace}
                      placeholder="The Merchant's name"
                    />
                  </div>
                </div>

                <div className="ops-toggles">
                  <div className="ops-toggle">
                    <Switch name="generatorOn" defaultChecked={depot.generatorOn}>
                      Generator running
                    </Switch>
                    <InfoIcon text={DEPOT_HELP.generatorOn} />
                  </div>
                  <div className="ops-toggle">
                    <Switch name="turretArmed" defaultChecked={depot.turretArmed}>
                      Turret armed
                    </Switch>
                    <InfoIcon text={DEPOT_HELP.turretArmed} />
                  </div>
                </div>

                <div className="ops-grid">
                  <DepotField name="fuelMax" label="Tank size" value={depot.fuelMax} help={DEPOT_HELP.fuelMax} />
                  <DepotField
                    name="fuelBurnPerTurn"
                    label="Fuel burned per turn"
                    value={depot.fuelBurnPerTurn}
                    help={DEPOT_HELP.fuelBurnPerTurn}
                  />
                  <DepotField name="coalFuel" label="Fuel per Coal" value={depot.coalFuel} help={DEPOT_HELP.coalFuel} />
                  <DepotField
                    name="saltpeterFuel"
                    label="Fuel per Saltpeter"
                    value={depot.saltpeterFuel}
                    help={DEPOT_HELP.saltpeterFuel}
                  />
                  <DepotField
                    name="shuttleMaxTurns"
                    label="Shuttle stays (turns)"
                    value={depot.shuttleMaxTurns}
                    help={DEPOT_HELP.shuttleMaxTurns}
                  />
                  <DepotField
                    name="shuttleCooldown"
                    label="Shuttle cooldown (turns)"
                    value={depot.shuttleCooldown}
                    help={DEPOT_HELP.shuttleCooldown}
                  />
                  <DepotField
                    name="creditCapObols"
                    label="Credit cap (¢)"
                    value={depot.creditCapObols}
                    help={DEPOT_HELP.creditCapObols}
                  />
                </div>

                <div className="field">
                  <span className="flex items-center gap-2">
                    <label htmlFor="depot-turretTable" className="field-label">
                      Turret severity table
                    </label>
                    <InfoIcon text={DEPOT_HELP.turretTable} />
                  </span>
                  <textarea
                    id="depot-turretTable"
                    name="turretTable"
                    rows={12}
                    className="mono"
                    defaultValue={JSON.stringify(turretTable(depot), null, 2)}
                  />
                </div>

                <div className="ops-actions">
                  <SubmitButton pendingLabel="Saving…">Save the Depot</SubmitButton>
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

          {section === "assignments" ? (
            <section className="ops-section ops-section--wide">
              <div className="ops-section-head">
                <h2 className="section-title">Assignments</h2>
                <p className="ops-lede">
                  Every player on the roster, in the game or not. Assign hands a seat to a character
                  who already exists; Spawn offers a whole new one over DM. Most opt-ins are decoys,
                  so what somebody ticked is context, not a gate. ‡
                </p>
              </div>
              <ThreatAssignmentsTable
                rows={assignmentRows}
                threats={THREAT_SUMMARY}
                roles={spawnRoles}
                locations={spawnLocations}
              />
            </section>
          ) : null}

          {section === "antagonists" ? (
            <section className="ops-section ops-section--wide">
              <div className="ops-section-head">
                <h2 className="section-title">Antagonists</h2>
                <p className="ops-lede">
                  Who holds a seat right now, read off the seat tag itself — so a tag granted by hand
                  from a character panel shows up here too. ‡
                </p>
              </div>
              <ThreatRosterTable
                rows={seatRows}
                pending={pendingSpawns}
                threats={ASSIGNABLE_SUMMARY}
              />
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
