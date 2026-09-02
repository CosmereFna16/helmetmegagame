"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import {
  prisma,
  advanceTurn as advanceTurnInDb,
  runFullChannelWipe,
  syncZonesFromYaml,
  syncSpecialChannels,
  syncTagsFromYaml,
  syncRolesFromYaml,
  syncDesiresFromYaml,
  syncDocumentsFromYaml,
} from "@lifeweb/db";
import { runChannelDoctor } from "@lifeweb/db/lib/channelDoctor";
// By path, not the barrel: it takes prisma as a parameter, the db/lib/dm.js
// convention that keeps it off the barrel (ARCHITECTURE.md §2).
import { postTurnsAnnouncement } from "@lifeweb/db/lib/turnAnnouncement";
import { auth } from "@/lib/auth";
import { isSuperadmin } from "@/lib/superadmin";
import {
  deleteCharacterRole,
  revokeAccessForCharacters,
  updateGuildNickname,
  listGuildMembers,
  removeCursedRole,
  setTurnPingRole,
  syncCharacterZoneRole,
  syncCharacterNarrowcastAccess,
  sendDm,
} from "@/lib/discordGuild";
import { applyPendingInvites } from "@lifeweb/db/lib/threadInvites";
import { rollCavingOnArrival } from "@lifeweb/db/lib/cavingPass";
import { getFactionAncestorIds } from "@/lib/factionPermissions";

async function requireSuperadmin() {
  const session = await auth();
  if (!session?.discordUserId || !isSuperadmin(session.discordUserId)) {
    throw new Error("Not authorized.");
  }
  return session;
}

function str(formData, key) {
  const v = formData.get(key);
  return v == null ? "" : v.toString();
}

function intOrNull(formData, key) {
  const v = str(formData, key).trim();
  if (v === "") return null;
  const n = Number.parseInt(v, 10);
  return Number.isNaN(n) ? null : n;
}

function intOrZero(formData, key) {
  return intOrNull(formData, key) ?? 0;
}

function floatOrDefault(formData, key, fallback) {
  const v = str(formData, key).trim();
  if (v === "") return fallback;
  const n = Number.parseFloat(v);
  return Number.isNaN(n) ? fallback : n;
}

export async function updateGameConfig(formData) {
  await requireSuperadmin();

  await prisma.gameConfig.upsert({
    where: { id: 1 },
    create: { id: 1 },
    update: {
      lifewebBlood: Math.max(0, Math.min(100, intOrZero(formData, "lifewebBlood"))),
      lifewebDecayPerTurn: intOrZero(formData, "lifewebDecayPerTurn"),
      openToPlayers: formData.get("openToPlayers") === "on",
      leaderWhitelistEnabled: formData.get("leaderWhitelistEnabled") === "on",
      playtestModeEnabled: formData.get("playtestModeEnabled") === "on",
      autoTurnAdvanceDisabled: formData.get("autoTurnAdvanceDisabled") === "on",
      avatarUploadsEnabled: formData.get("avatarUploadsEnabled") === "on",
      portraitMakerEnabled: formData.get("portraitMakerEnabled") === "on",
      portraitFantasyPartsEnabled: formData.get("portraitFantasyPartsEnabled") === "on",
      messageWipeEnabled: formData.get("messageWipeEnabled") === "on",
      tupperAutocorrectEnabled: formData.get("tupperAutocorrectEnabled") === "on",
      nicknameSyncEnabled: formData.get("nicknameSyncEnabled") === "on",
      archiveVisible: formData.get("archiveVisible") === "on",
      archiveTravelEvents: formData.get("archiveTravelEvents") === "on",
      catatonicEnabled: formData.get("catatonicEnabled") === "on",
      catatonicTurns: Math.max(1, intOrNull(formData, "catatonicTurns") ?? 4),
      // Floored at 0, not 1 — 0 is the off switch for the death pass, the
      // engine's one auto-kill (db/lib/catatonicDeathPass.js).
      catatonicDeathTurns: Math.max(0, intOrNull(formData, "catatonicDeathTurns") ?? 4),
      autoReconcileEnabled: formData.get("autoReconcileEnabled") === "on",
      desiresEnabled: formData.get("desiresEnabled") === "on",
      productionCoefficient: floatOrDefault(formData, "productionCoefficient", 1),
      startingTagPoints: intOrZero(formData, "startingTagPoints"),
      // Guarded at 1 because it's the denominator of every weighted role's
      // seat cap — a 0 here would collapse the whole role picker.
      playerCount: Math.max(1, intOrZero(formData, "playerCount")),
      equipSlots: Math.max(1, intOrZero(formData, "equipSlots")),
      // 0 is a real setting here — "no drawbacks at all" is coherent, only a
      // negative cap is nonsense.
      maxDrawbackTags: Math.max(0, intOrZero(formData, "maxDrawbackTags")),
      // Same floor-at-1 posture as equipSlots — a zero-slot Desire economy
      // isn't a coherent state, unlike zero drawbacks above.
      desireSlots: Math.max(1, intOrZero(formData, "desireSlots")),
      desireSlotLockTurns: Math.max(0, intOrZero(formData, "desireSlotLockTurns")),
    },
  });

  revalidatePath("/gm/dev");
  revalidatePath("/lifeweb");
  // These knobs feed the character-creation wizard's budget, seat caps and
  // drawback limit…
  revalidatePath("/character");
  // …and the store shows the same drawback readout.
  revalidatePath("/store");
}

// Directly overrides the current turn's day/phase (creating one if none is
// open) rather than routing through Needs resolution — a raw superadmin
// correction, not a normal turn advance.
export async function updateCurrentTurn(formData) {
  await requireSuperadmin();

  const day = intOrNull(formData, "day");
  const phase = str(formData, "phase") || "DAWN";
  const weather = str(formData, "weather") || "CLEAR";
  if (day == null || day < 1) return;

  const number = (day - 1) * 2 + (phase === "DAWN" ? 1 : 2);

  const openTurnRecord = await prisma.turn.findFirst({ where: { status: "OPEN" } });
  if (openTurnRecord) {
    await prisma.turn.update({ where: { id: openTurnRecord.id }, data: { number, phase, weather } });
  } else {
    await prisma.turn.create({ data: { number, phase, weather, status: "OPEN", gameDate: new Date() } });
  }

  revalidatePath("/gm/dev");
  revalidatePath("/", "layout");
}

// Sets the pending weather/note for the *next* turn, consumed by
// advanceTurn() in @lifeweb/db when the turn actually advances. Leaving
// weather unset (empty string -> null) means "roll randomly" there.
export async function updateNextTurn(formData) {
  await requireSuperadmin();

  const weather = str(formData, "weather").trim() || null;
  const note = str(formData, "note").trim() || null;

  await prisma.gameConfig.upsert({
    where: { id: 1 },
    create: { id: 1, nextWeather: weather, nextTurnNote: note },
    update: { nextWeather: weather, nextTurnNote: note },
  });

  revalidatePath("/gm/dev");
}

// advanceTurnInDb() composes every Discord side effect (Hunger DMs, the turn
// announcement, and the Dawn message wipe if GameConfig.messageWipeEnabled is
// on) but hands them back as a thunk rather than running them — REST-based, so
// nothing gateway-specific is needed here.
//
// That thunk goes to after(), never into the request. The Dawn wipe walks every
// Location's channels sequentially and can take minutes; awaiting it here used
// to hold the server action open for the whole time, and a pending action
// blocks client-side navigation — so the Dev Panel appeared to freeze until you
// hard-refreshed. Now the response carries the already-committed new turn and
// Discord catches up behind it.
export async function forceAdvanceTurn() {
  const session = await requireSuperadmin();

  try {
    const { advanced, previousTurn, newTurn, runSideEffects } = await advanceTurnInDb();

    // Lost the race to the bot's cron or a second click. The turn did advance,
    // so the panel should still repaint — there's just nothing of ours to log
    // and no side effects of ours to run.
    if (!advanced) {
      revalidatePath("/gm/dev");
      revalidatePath("/", "layout");
      return { ok: true };
    }

    await prisma.auditLog.create({
      data: {
        actorDiscordUserId: session.discordUserId,
        actionType: "superadmin_turn_forced",
        details: { previousTurnId: previousTurn?.id ?? null, newTurnId: newTurn.id, number: newTurn.number, phase: newTurn.phase, weather: newTurn.weather },
      },
    });

    revalidatePath("/gm/dev");
    revalidatePath("/", "layout");

    after(() =>
      runSideEffects().catch((err) => console.error("Turn side effects failed:", err)),
    );

    return { ok: true };
  } catch (err) {
    // There's no error.js boundary in this app, so an uncaught throw here
    // would replace the panel with Next's generic error page and leave the GM
    // unable to tell whether the turn advanced. Report it in place instead.
    console.error("Force advance turn failed:", err);
    return { ok: false, error: "Could not end the turn. Check the server logs." };
  }
}

// Matches GameConfig's schema @default values for the balance-knob fields
// surfaced on the "Game Config" form above — deliberately excludes
// nextWeather/nextTurnNote (handled separately, "Next Turn" section) and the
// Discord provisioning pointer (turnsConsoleChannelId/MessageId), which
// finishGameWipe overwrites for itself: it reposts the console right after
// fullWipe clears #turns, so the pointer it writes is the live message.
//
// Leaving it set is also the safety net. If that repost fails, the stale id
// is exactly what makes the bot repost on its next ready — ensureTurnsConsole
// fetches the tracked message, gets null, and posts a new one. Clearing it
// here would lose nothing and gain nothing.
//
// This comment used to claim the pointer "self-heals" because the next turn
// advance reposts the message. True, but the next turn advance is half a day
// away, and that reading is why a Restart Game left players staring at an
// empty #turns through the whole of Day 1 / Dawn.
const DEFAULT_GAME_CONFIG = {
  lifewebBlood: 100,
  lifewebDecayPerTurn: 10,
  openToPlayers: false,
  leaderWhitelistEnabled: true,
  playtestModeEnabled: false,
  autoTurnAdvanceDisabled: false,
  avatarUploadsEnabled: false,
  portraitMakerEnabled: false,
  portraitFantasyPartsEnabled: false,
  messageWipeEnabled: false,
  tupperAutocorrectEnabled: true,
  nicknameSyncEnabled: false,
  archiveVisible: false,
  archiveTravelEvents: false,
  productionCoefficient: 1,
  startingTagPoints: 12,
  playerCount: 100,
  equipSlots: 6,
  maxDrawbackTags: 5,
  desireSlots: 2,
  desireSlotLockTurns: 2,
  catatonicEnabled: true,
  catatonicTurns: 4,
  catatonicDeathTurns: 4,
  autoReconcileEnabled: false,
  desiresEnabled: true,
};

// Full game restart for dev/testing: wipes every player- and turn-scoped
// row (characters, tags-on-characters, Moves, default efforts, notes, DM
// log, audit log, silo history, and the /archive transcript), resets
// GameConfig's balance knobs to their schema defaults, clears every Discord
// channel this game has actually written to (#turns, and every zone's
// summary/public/private channel — messages, forum posts, and threads, public
// or private), and opens a fresh Turn 1/DAWN — then reposts the #turns
// console for it, which the channel wipe just deleted.
//
// The transcript is a DATABASE TABLE (ArchiveEntry), not a channel: it is
// recorded at send time and there has been no #archive channel since
// (CHANNELS.md §5). It is cleared by the transaction below, never by any
// Discord pass — this comment used to say otherwise, which read as "archive:
// handled" and is how the deleteMany came to be missing. Then re-syncs every YAML master, in dependency
// order, so the game starts from the canonical sets:
//   zones (docs/zones.yaml) -> special channels -> tags (docs/tags.yaml) ->
//   roles (docs/roles.yaml)
// Roles resolve a starting zone and validate starting_tags, so that
// order is load-bearing, not cosmetic. The #watch/#intercom channel ids on
// GameConfig are left untouched (same "self-heals, provisioning is one-time"
// treatment as turnsAnnouncementChannelId) rather than reset here.
//
// The four syncs do NOT share one contract, which is worth knowing before
// relying on any of them: syncZonesFromYaml is fully destructive (a
// zone dropped from the YAML loses its Discord category, channels, role and
// row; a topic loses its forum post), syncDocumentsFromYaml is destructive in the same
// sense but with nothing to delete in Discord (a Document is pure reference
// content, so a dropped key just loses its row), syncRolesFromYaml prunes
// only rows nothing references, and syncTagsFromYaml is a pure upsert that
// never deletes.
// Faction silos reset to 0 and are then re-seeded by the role sync below
// (seedSilos: true) to their computed opening balance — the same "back to
// day one" treatment as the Turn counter, rather than carrying over stale
// economy numbers.
//
// Requires typing the literal string "WIPE" in the confirm field — this is
// the most destructive action in the Dev Panel and has no undo.
export async function wipeGameData(formData) {
  const session = await requireSuperadmin();

  if (str(formData, "confirm").trim() !== "WIPE") {
    return { ok: false, error: 'Type "WIPE" (all caps) to confirm.' };
  }

  try {
    // Snapshotted BEFORE the deletes, and closed over by the thunk below:
    // by the time the Discord work runs these rows are gone, and their
    // discordUserId/discordRoleId are the only handles on what to clean up.
    const [characters, members] = await Promise.all([
      prisma.character.findMany({
        select: { discordUserId: true, discordRoleId: true, turnPingOptIn: true },
      }),
      listGuildMembers(),
    ]);
    const cursedRoleId = process.env.DISCORD_CURSED_ROLE_ID;
    const cursedMemberIds = cursedRoleId ? members.filter((m) => m.roles.includes(cursedRoleId)).map((m) => m.id) : [];

    // Deletes ordered so dependents go before the Character/Turn rows they
    // reference (Prisma doesn't cascade by default here). Request and Desire
    // both carry a required FK to Character (Request also has an optional one
    // to Turn), and StagedMessage/StagedEffect both carry a required FK to
    // Turn, so they all have to go before character/turn.deleteMany or those
    // statements throw a Postgres FK violation that rolls back the whole
    // transaction, wiping nothing at all.
    await prisma.$transaction([
      prisma.note.deleteMany({}),
      prisma.defaultEffort.deleteMany({}),
      prisma.action.deleteMany({}),
      prisma.request.deleteMany({}),
      prisma.desire.deleteMany({}),
      prisma.birdMessage.deleteMany({}),
      prisma.characterTag.deleteMany({}),
      prisma.auditLog.deleteMany({}),
      prisma.character.deleteMany({}),
      prisma.playerThread.deleteMany({}),
      prisma.playerThreadInvite.deleteMany({}),
      prisma.stagedMessage.deleteMany({}),
      prisma.stagedEffect.deleteMany({}),
      prisma.turn.deleteMany({}),
      prisma.siloTransaction.deleteMany({}),
      prisma.directMessage.deleteMany({}),
      // The transcript (/archive). Carries no foreign keys — snapshot columns
      // only, ARCHITECTURE.md §6 — so the ordering rules above do not apply to
      // it and it sits with the other log tables. Its absence here is why a
      // restart used to leave the whole previous game readable at /archive:
      // it is in nobody's dependency chain, so it never came up while that
      // ordering was being worked out.
      prisma.archiveEntry.deleteMany({}),
      prisma.faction.updateMany({ data: { silo: 0 } }),
      prisma.gameConfig.update({
        where: { id: 1 },
        data: { ...DEFAULT_GAME_CONFIG, nextWeather: null, nextTurnNote: null },
      }),
    ]);

    const firstTurn = await prisma.turn.create({
      data: { number: 1, phase: "DAWN", weather: "CLEAR", status: "OPEN", gameDate: new Date() },
    });

    await prisma.auditLog.create({
      data: {
        actorDiscordUserId: session.discordUserId,
        actionType: "superadmin_game_wipe",
        details: { characters: characters.length, cursedMembers: cursedMemberIds.length },
      },
    });

    // The report row exists BEFORE the background work starts, so a container
    // that dies partway leaves an unfinished report (finishedAt null) — which
    // is itself the signal — instead of a panel claiming success it can't
    // know about.
    const reportRow = await prisma.systemReport.create({
      data: { kind: "WIPE", actorDiscordUserId: session.discordUserId },
    });

    revalidatePath("/gm/dev");
    revalidatePath("/", "layout");

    after(() =>
      finishGameWipe(session.discordUserId, characters, cursedMemberIds, firstTurn, reportRow.id).catch(
        (err) => console.error("Game wipe side effects failed:", err),
      ),
    );

    return { ok: true, reportId: reportRow.id };
  } catch (err) {
    // There's no error.js boundary in this app, so an uncaught throw here
    // would replace the panel with Next's generic error page and leave the GM
    // unable to tell whether the wipe happened. Report it in place instead.
    console.error("Game wipe failed:", err);
    return { ok: false, error: "Could not wipe the game. Check the server logs." };
  }
}

// Everything the wipe does outside the database, handed to after() rather than
// awaited — the same split forceAdvanceTurn uses, and for the same reason.
// This walks every channel in the game twice over and then re-syncs the YAML
// masters; awaiting it held the server action open for minutes, and a pending
// server action blocks client-side navigation, so the panel froze.
//
// A step RUNNER, not a pile of bare .catch(() => {})s: every step is retried
// once, every failure is collected, and the whole run lands on the
// SystemReport row wipeGameData created — which the Dev Panel renders instead
// of claiming success it cannot know about. This is the fix for the old
// failure mode where a rate-limited setTurnPingRole left a player still
// pinged with zero visibility. The last step is the channel doctor with
// apply, which reconciles whatever the retries still missed — the structural
// backstop, not a bigger retry count.
//
// If the container dies partway, the report row is left unfinished
// (finishedAt null), which the panel shows for what it is.
async function finishGameWipe(actorDiscordUserId, characters, cursedMemberIds, firstTurn, reportId) {
  const steps = [];
  const failures = [];
  async function step(name, fn, { retries = 1 } = {}) {
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const detail = await fn();
        steps.push({ name, ok: true, ...(detail !== undefined && detail !== null ? { detail } : {}) });
        return detail;
      } catch (err) {
        if (attempt === retries) {
          steps.push({ name, ok: false, message: err.message });
          failures.push({ step: name, message: err.message });
          console.error(`Game wipe step "${name}" failed:`, err);
          return null;
        }
      }
    }
    return null;
  }

  // First, while nothing has re-provisioned: strip every character's zone
  // role and every stray member overwrite. One bulk pass, channel-major —
  // see db/lib/accessSweep.js#revokeAccessForCharacters.
  await step("access sweep", () => revokeAccessForCharacters(characters));

  // Sequential, not Promise.all — 240+ simultaneous requests at roster scale
  // against two per-guild buckets is its own incident. Each character's
  // cleanup is its own step, so one player's failure names them rather than
  // vanishing into a loop.
  for (const c of characters) {
    if (c.discordRoleId) {
      await step(`character role ${c.discordRoleId}`, () => deleteCharacterRole(c.discordRoleId));
    }
    await step(`nickname ${c.discordUserId}`, () => updateGuildNickname(c.discordUserId, null), {
      retries: 0,
    });
    // A restart should not leave anyone still holding last game's turn-ping
    // guild role — that is Discord role state, not touched by the DB wipe
    // above.
    if (c.turnPingOptIn) {
      await step(`turn-ping ${c.discordUserId}`, () => setTurnPingRole(c.discordUserId, false));
    }
  }

  // A full restart should not leave anyone still cursed from the last game.
  for (const id of cursedMemberIds) {
    await step(`cursed ${id}`, () => removeCursedRole(id));
  }

  await step("full channel wipe", () => runFullChannelWipe(prisma));

  // After the wipe, never before it: the line above bulk-deletes every message
  // in #turns, including this one if it were posted first.
  //
  // wipeGameData opens Turn 1 with a plain turn.create rather than through
  // advanceTurn() — there is no turn to close, and no roster to run default
  // moves, hunger or DMs against — so runSideEffects() never fires and the
  // announcement that normally rides it never went out. Same call the turn
  // engine makes; the note is null because the transaction already cleared
  // nextTurnNote.
  await step("turns console repost", () => postTurnsAnnouncement(prisma, firstTurn, null));

  // Re-sync every YAML master, in dependency order, so the game starts from
  // the canonical sets. Roles resolve a starting zone and validate
  // starting_tags, so that order is load-bearing, not cosmetic. The special
  // channels come right after zones because their view grants name the zone
  // roles the zone sync may just have recreated.
  await step("zone sync", () => syncZonesFromYaml(prisma));
  await step("special channels sync", () => syncSpecialChannels(prisma));
  await step("tag sync", () => syncTagsFromYaml(prisma));
  // seedSilos: true — the fix for silo seeding otherwise being dead on
  // restart (Faction rows persist across the wipe, and an ordinary sync only
  // seeds silo on CREATE). This re-seeds every faction's silo to its computed
  // opening balance at the playerCount the same transaction just reset to
  // 100 — a smaller game needs playerCount set on /gm/dev, then
  // `db:sync-roles -- --seed-silos` run by hand afterward.
  await step("role sync", () => syncRolesFromYaml(prisma, { seedSilos: true }));
  // Desires validate requires.anyTags/notTags and anyRoles/notRoles against
  // the DB, so this has to come after tag sync and role sync. DesireTemplate
  // rows are NOT wiped above — catalog, not player state — this just
  // reconciles scalars/links/retirement against docs/desires.yaml.
  await step("desire sync", () => syncDesiresFromYaml(prisma));
  // Last: its assignment references are validated against the Tag/Role/
  // Faction rows the syncs above create.
  await step("document sync", () => syncDocumentsFromYaml(prisma));

  // The structural backstop: whatever a retry above still missed, the doctor
  // finds by diffing Discord against the (now empty) roster and repairs.
  await step("channel doctor", () =>
    runChannelDoctor(prisma, { apply: true, scope: "cheap", actorDiscordUserId }),
  );

  const okSteps = steps.filter((s) => s.ok).length;
  await prisma.systemReport
    .update({
      where: { id: reportId },
      data: {
        finishedAt: new Date(),
        ok: failures.length === 0,
        summary: { steps: steps.length, okSteps, failedSteps: failures.length },
        failures,
      },
    })
    .catch((err) => console.error("Game wipe report write failed:", err));

  // The audit row stays alongside the report — /gm/audit is the historical
  // record, the report is the operational one.
  await prisma.auditLog
    .create({
      data: {
        actorDiscordUserId,
        actionType: "superadmin_game_wipe_finished",
        details: { reportId, steps: steps.length, failed: failures.length },
      },
    })
    .catch((err) => console.error("Game wipe completion audit failed:", err));
}

export async function updateFaction(formData) {
  const session = await requireSuperadmin();

  const factionId = str(formData, "factionId");
  if (!factionId) return;

  const before = await prisma.faction.findUnique({ where: { id: factionId } });
  if (!before) return;

  const newSilo = intOrZero(formData, "silo");
  const siloDelta = newSilo - before.silo;

  const parentFactionId = str(formData, "parentFactionId").trim() || null;
  if (parentFactionId) {
    if (parentFactionId === factionId) return;
    // Reject a cycle: the faction being edited can't already be an ancestor
    // of the faction it's about to be parented under.
    const ancestorIds = await getFactionAncestorIds(parentFactionId);
    if (ancestorIds.includes(factionId)) return;
  }

  await prisma.faction.update({
    where: { id: factionId },
    data: {
      name: str(formData, "name").trim(),
      silo: newSilo,
      parentFactionId,
    },
  });

  if (siloDelta !== 0) {
    const openTurn = await prisma.turn.findFirst({ where: { status: "OPEN" } });
    await prisma.siloTransaction.create({
      data: {
        factionId,
        amount: siloDelta,
        actorDiscordUserId: session.discordUserId,
        actorName: "GM (Dev Panel)",
        note: "Manual Dev Panel adjustment",
        turnNumber: openTurn?.number ?? null,
        turnPhase: openTurn?.phase ?? null,
      },
    });
  }

  revalidatePath("/gm/dev/factions");
  revalidatePath("/faction");
  revalidatePath("/gm/players", "layout");
}

// Reassigns the faction's members to "Unaffiliated" (same pattern as
// removeCharacterFromFaction in faction/actions.js) before deleting the row.
export async function deleteFaction(formData) {
  const session = await requireSuperadmin();

  const factionId = str(formData, "factionId");
  if (!factionId) return;

  const faction = await prisma.faction.findUnique({ where: { id: factionId } });
  if (!faction || faction.name === "Unaffiliated") return;

  const unaffiliated = await prisma.faction.findFirst({ where: { name: "Unaffiliated" } });
  if (unaffiliated) {
    await prisma.character.updateMany({
      where: { factionId },
      data: { factionId: unaffiliated.id, isLeader: false },
    });
  }

  await prisma.faction.delete({ where: { id: factionId } });

  await prisma.auditLog.create({
    data: {
      actorDiscordUserId: session.discordUserId,
      actionType: "faction_deleted",
      details: { factionId, name: faction.name },
    },
  });

  revalidatePath("/gm/dev/factions");
  revalidatePath("/faction");
  revalidatePath("/gm/players", "layout");
}

// --- Channel doctor + system reports ----------------------------------

// Both run in after() and land on a SystemReport row — the section on
// /gm/dev polls the latest report per kind, so the button returns
// immediately and the outcome shows up where every other operational pass
// reports (db/lib/channelDoctor.js).
export async function runDoctorAction(formData) {
  const session = await requireSuperadmin();
  const apply = str(formData, "mode") === "repair";
  const scope = str(formData, "scope") === "full" ? "full" : "cheap";

  after(() =>
    runChannelDoctor(prisma, { apply, scope, actorDiscordUserId: session.discordUserId }).catch((err) =>
      console.error("Channel doctor action failed:", err),
    ),
  );

  revalidatePath("/gm/dev");
  return { ok: true };
}

// GM bulk move: relocate many characters to one zone at once. A raw
// relocation like updateCharacterRaw's, not a travel — no Move cost, no
// Action filed, no adjacency check. The Discord half (role swap, narrowcast,
// pending invites) runs in after(), sequential, and lands on a
// SystemReport (kind: BULK_MOVE) like every other long pass.
export async function bulkMoveCharacters(formData) {
  const session = await requireSuperadmin();

  const zoneId = str(formData, "zoneId");
  const characterIds = formData.getAll("characterIds").map(String).filter(Boolean);
  if (!zoneId || characterIds.length === 0) {
    return { ok: false, error: "Pick a zone and at least one character." };
  }

  const zone = await prisma.zone.findUnique({ where: { id: zoneId } });
  if (!zone || zone.kind === "CAVE_GROUP") {
    return { ok: false, error: "That isn't a zone a character can stand in." };
  }

  const characters = await prisma.character.findMany({
    where: { id: { in: characterIds }, status: "ALIVE" },
    select: { id: true, name: true, discordUserId: true, zoneId: true },
  });
  if (characters.length === 0) return { ok: false, error: "No living characters matched." };

  await prisma.character.updateMany({
    where: { id: { in: characters.map((c) => c.id) } },
    data: { zoneId: zone.id },
  });

  const report = await prisma.systemReport.create({
    data: {
      kind: "BULK_MOVE",
      actorDiscordUserId: session.discordUserId,
      summary: { zone: zone.name, characters: characters.length },
    },
  });

  await prisma.auditLog.create({
    data: {
      actorDiscordUserId: session.discordUserId,
      actionType: "gm_bulk_move",
      details: { zoneId: zone.id, zoneName: zone.name, characterIds: characters.map((c) => c.id) },
    },
  });

  after(async () => {
    const failures = [];
    for (const c of characters) {
      try {
        await syncCharacterZoneRole(c.discordUserId, c.zoneId, zone.id);
        await syncCharacterNarrowcastAccess(c.id);
        await applyPendingInvites(prisma, { ...c, zoneId: zone.id });
      } catch (err) {
        failures.push({ step: "move", target: c.name, message: err.message });
        console.error(`Bulk move: Discord sync failed for ${c.name}:`, err);
      }
      // One Caving Die per arrival, same as walking in — see
      // docs/systemdocs/CAVING.md. Null off a cave level, or if they had
      // already rolled this turn. Outside the try above on purpose: a Discord
      // sync that failed still moved the character, so they still get a roll.
      try {
        const cavingDm = await rollCavingOnArrival(prisma, { ...c, zoneId: zone.id }, zone);
        if (cavingDm) await sendDm(cavingDm.discordUserId, cavingDm.content);
      } catch (err) {
        failures.push({ step: "caving", target: c.name, message: err.message });
        console.error(`Bulk move: caving arrival DM failed for ${c.name}:`, err);
      }
    }
    await prisma.systemReport
      .update({
        where: { id: report.id },
        data: { finishedAt: new Date(), ok: failures.length === 0, failures },
      })
      .catch((err) => console.error("Bulk move report write failed:", err));
  });

  revalidatePath("/gm/dev");
  return { ok: true, moved: characters.length };
}
