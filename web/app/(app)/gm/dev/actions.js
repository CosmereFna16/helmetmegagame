"use server";

import { revalidatePath } from "next/cache";
import { isUnaffiliated, UNAFFILIATED_SLUG } from "@lifeweb/db/lib/factionConstants";
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
  sendDm,
} from "@/lib/discordGuild";
import { applyLocationMoveSideEffects } from "@lifeweb/db/lib/locationMove";
import { rollCavingOnArrival } from "@lifeweb/db/lib/cavingPass";
import { validateTurretTable } from "@lifeweb/db/lib/depotTurret";
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
      // Floored at 0: 0 is the off switch for the death pass (catatonicDeathPass.js).
      catatonicDeathTurns: Math.max(0, intOrNull(formData, "catatonicDeathTurns") ?? 4),
      // Floored at 0: 0 means a walk between locations has no cooldown at all.
      locationMoveCooldownSeconds: Math.max(0, intOrNull(formData, "locationMoveCooldownSeconds") ?? 60),
      autoReconcileEnabled: formData.get("autoReconcileEnabled") === "on",
      desiresEnabled: formData.get("desiresEnabled") === "on",
      productionCoefficient: floatOrDefault(formData, "productionCoefficient", 1),
      startingTagPoints: intOrZero(formData, "startingTagPoints"),
      // Floored at 1: it's the denominator of every weighted role's seat cap.
      playerCount: Math.max(1, intOrZero(formData, "playerCount")),
      equipSlots: Math.max(1, intOrZero(formData, "equipSlots")),
      carryWeightLbs: Math.max(1, intOrZero(formData, "carryWeightLbs")),
      carryResourceCap: Math.max(1, intOrZero(formData, "carryResourceCap")),
      freeZoneMovesPerTurn: Math.max(0, intOrZero(formData, "freeZoneMovesPerTurn")),
      maxDrawbackTags: Math.max(0, intOrZero(formData, "maxDrawbackTags")),
      maxDrawbackPoints: Math.max(0, intOrZero(formData, "maxDrawbackPoints")),
      desireSlots: Math.max(1, intOrZero(formData, "desireSlots")),
      desireSlotLockTurns: Math.max(0, intOrZero(formData, "desireSlotLockTurns")),
    },
  });

  revalidatePath("/gm/dev");
  revalidatePath("/lifeweb");
  revalidatePath("/character");
  revalidatePath("/store");
}

// The Depot's live state and its tuning, in one flat clamped allowlist —
// the same shape updateGameConfig uses, and for the same reason: a loop over
// formData keys would let a hand-posted field write a column nobody meant to
// expose.
//
// The turret table is the one field that can be REJECTED rather than clamped.
// A column that does not sum to 1 is not a preference, it is a broken die, and
// silently normalising it would hide a GM's typo behind subtly wrong odds for
// a month. validateTurretTable throws; the action swallows it into a returned
// error so the form can say so.
export async function updateDepot(formData) {
  await requireSuperadmin();

  let turretTable;
  const raw = str(formData, "turretTable");
  if (raw) {
    try {
      turretTable = JSON.parse(raw);
    } catch {
      return { error: "The turret table is not valid JSON." };
    }
    try {
      validateTurretTable(turretTable);
    } catch (err) {
      return { error: err.message };
    }
  }

  const fuelMax = Math.max(1, intOrZero(formData, "fuelMax"));

  await prisma.depot.upsert({
    where: { id: 1 },
    create: { id: 1 },
    update: {
      // Live state.
      accountObols: Math.max(0, intOrZero(formData, "accountObols")),
      debtObols: Math.max(0, intOrZero(formData, "debtObols")),
      // Clamped to the tank the GM is saving in the same submit, not the one
      // that was there before — otherwise raising both at once silently loses
      // the fuel.
      generatorFuel: Math.max(0, Math.min(fuelMax, intOrZero(formData, "generatorFuel"))),
      merchantFace: str(formData, "merchantFace"),
      generatorOn: formData.get("generatorOn") === "on",
      turretArmed: formData.get("turretArmed") === "on",

      // Tuning.
      fuelMax,
      fuelBurnPerTurn: Math.max(0, intOrZero(formData, "fuelBurnPerTurn")),
      coalFuel: Math.max(0, intOrZero(formData, "coalFuel")),
      saltpeterFuel: Math.max(0, intOrZero(formData, "saltpeterFuel")),
      shuttleMaxTurns: Math.max(1, intOrZero(formData, "shuttleMaxTurns")),
      shuttleCooldown: Math.max(0, intOrZero(formData, "shuttleCooldown")),
      creditCapObols: Math.max(0, intOrZero(formData, "creditCapObols")),
      // Never zero: the ⬢-to-obol conversion divides by it.
      ...(turretTable ? { turretTable } : {}),
    },
  });

  revalidatePath("/gm/dev");
  revalidatePath("/depot");
}

// A raw superadmin correction to the current turn's day/phase, not a
// normal turn advance.
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

// Pending weather/note for the *next* turn, consumed by advanceTurn().
// Empty string -> null weather means "roll randomly" there.
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

// advanceTurnInDb() hands back its Discord side effects as a thunk. That
// thunk goes to after(), not the request, since the Dawn wipe can take
// minutes and a pending server action blocks client-side navigation.
export async function forceAdvanceTurn() {
  const session = await requireSuperadmin();

  try {
    const { advanced, previousTurn, newTurn, runSideEffects } = await advanceTurnInDb();

    // Lost the race to the bot's cron or a second click; turn already advanced.
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
    // No error.js boundary here; report in place rather than let Next's
    // generic error page hide whether the turn advanced.
    console.error("Force advance turn failed:", err);
    return { ok: false, error: "Could not end the turn. Check the server logs." };
  }
}

// Matches GameConfig's schema @default values for the balance knobs above.
// Excludes nextWeather/nextTurnNote and the turns-console pointer, which
// finishGameWipe reposts and overwrites for itself.
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
  productionCoefficient: 0.93,
  startingTagPoints: 12,
  playerCount: 100,
  equipSlots: 6,
  carryWeightLbs: 120,
  carryResourceCap: 25,
  freeZoneMovesPerTurn: 1,
  maxDrawbackTags: 5,
  maxDrawbackPoints: 12,
  desireSlots: 2,
  desireSlotLockTurns: 2,
  catatonicEnabled: true,
  catatonicTurns: 4,
  catatonicDeathTurns: 4,
  locationMoveCooldownSeconds: 60,
  autoReconcileEnabled: false,
  desiresEnabled: true,
};

// Full game restart for dev/testing: wipes every player- and turn-scoped
// row, resets GameConfig's balance knobs, clears every Discord channel,
// opens Turn 1/DAWN, reposts #turns, then re-syncs every YAML master in
// dependency order. Requires typing "WIPE" — no undo.
export async function wipeGameData(formData) {
  const session = await requireSuperadmin();

  if (str(formData, "confirm").trim() !== "WIPE") {
    return { ok: false, error: 'Type "WIPE" (all caps) to confirm.' };
  }

  try {
    // Snapshotted before the deletes — the only handle left on what to
    // clean up once the DB rows are gone.
    const [characters, members] = await Promise.all([
      prisma.character.findMany({
        select: { discordUserId: true, discordRoleId: true, turnPingOptIn: true },
      }),
      listGuildMembers(),
    ]);
    const cursedRoleId = process.env.DISCORD_CURSED_ROLE_ID;
    const cursedMemberIds = cursedRoleId ? members.filter((m) => m.roles.includes(cursedRoleId)).map((m) => m.id) : [];

    // Ordered so dependents (Request, Desire, StagedMessage/Effect — required
    // FKs to Character/Turn) go before character/turn.deleteMany, or a
    // Postgres FK violation rolls back the whole transaction.
    await prisma.$transaction([
      prisma.note.deleteMany({}),
      prisma.action.deleteMany({}),
      prisma.request.deleteMany({}),
      prisma.desire.deleteMany({}),
      prisma.birdMessage.deleteMany({}),
      prisma.characterTag.deleteMany({}),
      // Anything pinned to a noticeboard (PAPERWORK.md). Before the tag sweep
      // below, or the FK from NoticePost.tagId blocks it.
      prisma.noticePost.deleteMany({}),
      // Room stashes (CARRY.md): the rows cascade from nothing the wipe
      // deletes, so they go explicitly and the ⬢ column is zeroed.
      prisma.roomTag.deleteMany({}),
      // Runtime-minted tags: crates, headstones, written paper, sealed
      // letters. GAME state that happened to be stored in the catalog, and it
      // has to go with the game.
      //
      // This closes a real leak rather than merely serving the new feature.
      // The wipe never touched the Tag table, and db:prune-tags skips every
      // `custom` row on purpose — so a crate or a headstone was a permanent
      // orphan accumulating across every game ever run. Only corpses escaped,
      // through corpseOfCharacterId's cascade, and they still do.
      //
      // `ephemeral` and not `custom`, deliberately: a GM's homebrew from
      // /gm/dev/tags is custom too and must SURVIVE a restart. Runs after the
      // holdings above so nothing references these rows.
      prisma.tag.deleteMany({ where: { ephemeral: true } }),
      prisma.room.updateMany({ data: { resources: 0 } }),
      // Factions are live game state now (FACTIONS.md), so a restart has to
      // undo the parts players wrote. Handshakes go with the characters they
      // named; every silo is un-pointed so db:sync-roles' null-fill floor can
      // seed the authored ones again; and a faction somebody FOUNDED in the
      // last game is deleted outright rather than lingering as a leaderless
      // ghost. Founded factions carry no Role rows, so nothing cascades into
      // the creation wizard.
      prisma.factionApplication.deleteMany({}),
      prisma.faction.updateMany({ data: { siloRoomId: null } }),
      prisma.auditLog.deleteMany({}),
      prisma.character.deleteMany({}),
      prisma.playerThread.deleteMany({}),
      prisma.playerThreadInvite.deleteMany({}),
      prisma.stagedMessage.deleteMany({}),
      prisma.stagedEffect.deleteMany({}),
      prisma.turn.deleteMany({}),
      prisma.directMessage.deleteMany({}),
      // The transcript: no foreign keys (snapshot columns only), so it must
      // be wiped explicitly or a restart leaves the last game readable.
      prisma.archiveEntry.deleteMany({}),
      prisma.gameConfig.update({
        where: { id: 1 },
        data: { ...DEFAULT_GAME_CONFIG, nextWeather: null, nextTurnNote: null },
      }),
    ]);

    // After the character sweep above, so the FK from Character.factionId is
    // already gone and the delete cannot be blocked by a member.
    await prisma.faction.deleteMany({ where: { foundedById: { not: null } } });

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

    // Created before the background work starts, so a dead container leaves
    // an unfinished report (finishedAt null) rather than a false success.
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
    // No error.js boundary here; report in place rather than let Next's
    // generic error page hide whether the wipe happened.
    console.error("Game wipe failed:", err);
    return { ok: false, error: "Could not wipe the game. Check the server logs." };
  }
}

// Everything the wipe does outside the database, handed to after() rather
// than awaited. A step runner: every step is retried once, every failure is
// collected, and the run lands on the SystemReport row wipeGameData
// created, so the Dev Panel never claims success it can't know about.
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

  // First, while nothing has re-provisioned: strip every zone role and
  // stray member overwrite.
  await step("access sweep", () => revokeAccessForCharacters(characters));

  // Sequential, not Promise.all — 240+ simultaneous requests against two
  // per-guild rate-limit buckets is its own incident.
  for (const c of characters) {
    if (c.discordRoleId) {
      await step(`character role ${c.discordRoleId}`, () => deleteCharacterRole(c.discordRoleId));
    }
    await step(`nickname ${c.discordUserId}`, () => updateGuildNickname(c.discordUserId, null), {
      retries: 0,
    });
    if (c.turnPingOptIn) {
      await step(`turn-ping ${c.discordUserId}`, () => setTurnPingRole(c.discordUserId, false));
    }
  }

  for (const id of cursedMemberIds) {
    await step(`cursed ${id}`, () => removeCursedRole(id));
  }

  await step("full channel wipe", () => runFullChannelWipe(prisma));

  // After the wipe, never before: it bulk-deletes every #turns message.
  await step("turns console repost", () => postTurnsAnnouncement(prisma, firstTurn, null));

  // Dependency order: roles resolve a starting zone and validate
  // starting_tags; special channels' view grants name the zone roles.
  await step("zone sync", () => syncZonesFromYaml(prisma));
  await step("special channels sync", () => syncSpecialChannels(prisma));
  await step("tag sync", () => syncTagsFromYaml(prisma));
  await step("role sync", () => syncRolesFromYaml(prisma));
  await step("desire sync", () => syncDesiresFromYaml(prisma));
  await step("document sync", () => syncDocumentsFromYaml(prisma));

  // Backstop: whatever a retry above missed, the doctor finds and repairs.
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
  await requireSuperadmin();

  const factionId = str(formData, "factionId");
  if (!factionId) return;

  const before = await prisma.faction.findUnique({ where: { id: factionId } });
  if (!before) return;

  const parentFactionId = str(formData, "parentFactionId").trim() || null;
  if (parentFactionId) {
    if (parentFactionId === factionId) return;
    // Reject a cycle: can't already be an ancestor of its new parent.
    const ancestorIds = await getFactionAncestorIds(parentFactionId);
    if (ancestorIds.includes(factionId)) return;
  }

  // A room id straight off the form. Validated by existence rather than
  // trusted, and "" clears the pointer.
  const siloRoomRaw = str(formData, "siloRoomId").trim();
  let siloRoomId = null;
  if (siloRoomRaw) {
    const room = await prisma.room.findUnique({ where: { id: siloRoomRaw }, select: { id: true } });
    if (!room) return;
    siloRoomId = room.id;
  }

  await prisma.faction.update({
    where: { id: factionId },
    data: {
      name: str(formData, "name").trim(),
      parentFactionId,
      siloRoomId,
    },
  });

  revalidatePath("/gm/dev/factions");
  revalidatePath("/faction");
  revalidatePath("/gm/players", "layout");
}

// Reassigns the faction's members to "Unaffiliated" before deleting the row.
export async function deleteFaction(formData) {
  const session = await requireSuperadmin();

  const factionId = str(formData, "factionId");
  if (!factionId) return;

  const faction = await prisma.faction.findUnique({ where: { id: factionId } });
  if (!faction || isUnaffiliated(faction)) return;

  const unaffiliated = await prisma.faction.findFirst({ where: { slug: UNAFFILIATED_SLUG } });
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

// Moves a character into a faction and sets their seats, in one write.
// Deliberately not built out of the player-facing actions: those all check
// "is this your faction", which is the check a GM is here to skip.
export async function assignFactionMember(formData) {
  const session = await requireSuperadmin();

  const characterId = str(formData, "characterId");
  const factionId = str(formData, "factionId");
  if (!characterId || !factionId) return;

  const [character, faction] = await Promise.all([
    prisma.character.findUnique({ where: { id: characterId }, select: { id: true, name: true } }),
    prisma.faction.findUnique({ where: { id: factionId }, select: { id: true, name: true, slug: true } }),
  ]);
  if (!character || !faction) return;

  const makeLeader = str(formData, "isLeader") === "true" && !isUnaffiliated(faction);
  const makeTreasurer = str(formData, "isTreasurer") === "true" && !isUnaffiliated(faction);

  await prisma.$transaction(async (tx) => {
    // One Leader per faction, same rule setFactionLeader keeps.
    if (makeLeader) {
      await tx.character.updateMany({
        where: { factionId, isLeader: true },
        data: { isLeader: false },
      });
    }
    await tx.character.update({
      where: { id: characterId },
      data: { factionId, isLeader: makeLeader, isTreasurer: makeTreasurer },
    });
    // Whatever they had open elsewhere is moot once a GM has placed them.
    await tx.factionApplication.updateMany({
      where: { characterId, status: "PENDING" },
      data: { status: "WITHDRAWN" },
    });
  });

  await prisma.auditLog.create({
    data: {
      actorDiscordUserId: session.discordUserId,
      actionType: "faction_member_assigned",
      targetCharacterId: characterId,
      details: { factionId, factionName: faction.name, isLeader: makeLeader, isTreasurer: makeTreasurer },
    },
  });

  revalidatePath("/gm/dev/factions");
  revalidatePath("/faction");
  revalidatePath("/gm/players", "layout");
}

// --- Channel doctor + system reports ----------------------------------

// Runs in after() and lands on a SystemReport row; /gm/dev polls the
// latest report per kind, so the button returns immediately.
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

// GM bulk move: relocate many characters to one Location at once. A raw
// relocation, not a travel — no Move cost, no Action, no adjacency check, and
// no cooldown stamp.
export async function bulkMoveCharacters(formData) {
  const session = await requireSuperadmin();

  const locationId = str(formData, "locationId");
  const characterIds = formData.getAll("characterIds").map(String).filter(Boolean);
  if (!locationId || characterIds.length === 0) {
    return { ok: false, error: "Pick a location and at least one character. ‡" };
  }

  const location = await prisma.location.findUnique({
    where: { id: locationId },
    include: { zone: true },
  });
  if (!location) {
    return { ok: false, error: "That isn't a place a character can stand. ‡" };
  }

  const characters = await prisma.character.findMany({
    where: { id: { in: characterIds }, status: "ALIVE" },
    select: { id: true, name: true, discordUserId: true, locationId: true, zoneId: true },
  });
  if (characters.length === 0) return { ok: false, error: "No living characters matched. ‡" };

  // The denormalization contract: locationId and zoneId are written together.
  await prisma.character.updateMany({
    where: { id: { in: characters.map((c) => c.id) } },
    data: { locationId: location.id, zoneId: location.zoneId },
  });

  const report = await prisma.systemReport.create({
    data: {
      kind: "BULK_MOVE",
      actorDiscordUserId: session.discordUserId,
      summary: { location: location.name, zone: location.zone?.name ?? null, characters: characters.length },
    },
  });

  await prisma.auditLog.create({
    data: {
      actorDiscordUserId: session.discordUserId,
      actionType: "gm_bulk_move",
      details: {
        locationId: location.id,
        locationName: location.name,
        zoneId: location.zoneId,
        zoneName: location.zone?.name ?? null,
        characterIds: characters.map((c) => c.id),
      },
    },
  });

  after(async () => {
    const failures = [];
    for (const c of characters) {
      try {
        await applyLocationMoveSideEffects(prisma, {
          characterId: c.id,
          fromLocationId: c.locationId,
          toLocationId: location.id,
        });
      } catch (err) {
        failures.push({ step: "move", target: c.name, message: err.message });
        console.error(`Bulk move: Discord sync failed for ${c.name}:`, err);
      }
      // One Caving Die per arrival, same as walking in — keyed on the ZONE.
      // Outside the try above: a failed Discord sync still moved the character.
      try {
        const cavingDm = await rollCavingOnArrival(
          prisma,
          { ...c, locationId: location.id, zoneId: location.zoneId },
          location.zone,
        );
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
