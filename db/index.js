// Shared Prisma client for the bot, the web app, and every script. Strips
// stray .env quotes from DATABASE_URL before @prisma/client is required,
// since the generated client snapshots its datasource env at load time.
function normalizedDatabaseUrl() {
  const raw = process.env.DATABASE_URL;
  if (!raw) return raw;
  const unquoted = raw.trim().replace(/^(["'])([\s\S]*)\1$/, "$2");
  if (unquoted !== raw) process.env.DATABASE_URL = unquoted;
  return unquoted;
}

const databaseUrl = normalizedDatabaseUrl();

const { PrismaClient, Prisma } = require("@prisma/client");
const { rollWeather, buildTurnAnnouncement } = require("./weather");
const { postTurnsAnnouncement } = require("./lib/turnAnnouncement");
const { expiryFrom } = require("./lib/turnFormat");
const { runCorpseRotPass } = require("./lib/corpseRotPass");
const { reconcileCorpses } = require("./lib/corpseFollow");
const { runTagExpiryPass } = require("./lib/tagExpiryPass");
// By path, not the barrel — same reason as db/lib/dm.js below.
const { runDawnWipe } = require("./lib/dawnWipe");
const { runHungerPass, hungerDm, disappointedDm, DYING_DM } = require("./lib/hungerPass");
const { runCarryPass } = require("./lib/carryPass");
const { deliverCarryDrop } = require("./lib/carry");
const { runCatatonicPass } = require("./lib/catatonicPass");
const { runCatatonicDeathPass } = require("./lib/catatonicDeathPass");
const { runDyingDeathPass } = require("./lib/dyingDeathPass");
const { runBirdPass } = require("./lib/birdPass");
// By path, not the barrel — see the note at the top of db/lib/accessSweep.js.
const { revokeAllCharacterAccess } = require("./lib/accessSweep");
const { LEAVE_ANNOUNCE_CHANNEL_ID } = require("./lib/constants");
const { runCavingPass } = require("./lib/cavingPass");
const { runAutoLaborPass } = require("./lib/autoLaborPass");
const { runLaborYieldPass } = require("./lib/laborYield");
const { runStagedPushPass } = require("./lib/stagedPush");
const { runLessonPass } = require("./lib/lessonPass");
// Required by path, not through the barrel: see db/lib/dm.js for why there
// are three same-named sendDm exports with three signatures.
const { sendDm } = require("./lib/dm");
const { recordArchiveMessage, recordArchiveEvent } = require("./lib/archive");
const { loadForcedName } = require("./lib/presentedIdentity");
const { postAsCharacter, postMessage, postMessageBatched, attachBreakerStore, patchGuildRole, deleteGuildRole, addMemberRole, getGuildMember, setGuildNickname } = require("./lib/discordRest");
const { bumpBlood, LIFEWEB_SPUTTER_THRESHOLD } = require("./lib/lifeweb");
const { runFullChannelWipe } = require("./lib/fullWipe");
const { syncZonesFromYaml } = require("./lib/syncZones");
const { syncTagsFromYaml } = require("./lib/syncTags");
const { deleteCharacterRow } = require("./lib/deleteCharacter");
const { syncRolesFromYaml } = require("./lib/syncRoles");
const { syncDesiresFromYaml } = require("./lib/syncDesires");
const { syncDocumentsFromYaml } = require("./lib/syncDocuments");
const { SPECIAL_CHANNELS, NARROWCAST_SLUGS, buildNarrowcastContext, computeNarrowcastAccess } = require("./lib/specialChannels");
const { syncSpecialChannels } = require("./lib/syncSpecialChannels");

const globalForPrisma = globalThis;

// Cached unconditionally (not gated on NODE_ENV): Turbopack bundles this
// module into two separate chunks/registries in the web build, and gating
// the cache meant two PrismaClients per container. transactionOptions raises
// Prisma's defaults (2s/5s) because the per-character transactions in
// db/lib/autoLaborPass.js compete for pool slots at turn rollover.
const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    ...(databaseUrl ? { datasourceUrl: databaseUrl } : {}),
    transactionOptions: { maxWait: 5000, timeout: 15000 },
    // Character.avatarData is a 10-25 KB blob served out-of-band by the
    // avatar route; omitting it globally stops it riding along on every
    // `include`. An explicit `select: { avatarData: true }` still overrides.
    omit: { character: { avatarData: true } },
  });

globalForPrisma.prisma = prisma;

// Hands the Discord circuit breaker somewhere durable to keep its counters.
// discordRest.js has no prisma dependency (this file requires IT), so the
// two functions are passed in rather than required back.
attachBreakerStore({
  read: () =>
    prisma.gameConfig.findUnique({
      where: { id: 1 },
      select: {
        restInvalidCount: true,
        restInvalidWindowStart: true,
        restBreakerOpenUntil: true,
      },
    }),
  // updateMany, not update: on a brand-new database GameConfig may not exist
  // yet, and a rate-limit count shouldn't create it as a side effect.
  write: (data) => prisma.gameConfig.updateMany({ where: { id: 1 }, data }),
});



// The stackable half of resolveNeeds()' expiry sweep: each expired stack
// loses one unit and the remainder's clock restarts from the tag's catalog
// duration, so a stack sheds one unit at a time rather than all at once.
// `model` is "characterTag" or "roomTag": a stack lying in a Room sheds
// exactly the way one in a pocket does (docs/systemdocs/CARRY.md).
async function sweepExpiredStacks(turn, model = "characterTag") {
  const expired = await prisma[model].findMany({
    where: { expiresTurn: { lte: turn.number }, tag: { stackable: true } },
    select: { id: true, quantity: true, tag: { select: { defaultDurationTurns: true } } },
  });
  if (expired.length === 0) return;

  const spent = [];
  // new expiresTurn -> ids landing on it
  const rescheduled = new Map();
  for (const ct of expired) {
    if (ct.quantity <= 1) {
      spent.push(ct.id);
      continue;
    }
    const next = expiryFrom(turn.number + 1, ct.tag.defaultDurationTurns ?? 1);
    if (!rescheduled.has(next)) rescheduled.set(next, []);
    rescheduled.get(next).push(ct.id);
  }

  await prisma.$transaction([
    ...(spent.length ? [prisma[model].deleteMany({ where: { id: { in: spent } } })] : []),
    // decrement, not a computed literal, so a concurrent grant on the same
    // row can't be clobbered between the read above and this write.
    ...[...rescheduled].map(([expiresTurn, ids]) =>
      prisma[model].updateMany({
        where: { id: { in: ids } },
        data: { quantity: { decrement: 1 }, expiresTurn },
      }),
    ),
  ]);
}

// Applies per-turn Needs decay to the turn being closed, shared by the bot's
// cron advance and the GM dashboard's manual close-turn. Returns Discord work
// (posts/DMs) for the caller's runSideEffects() rather than sending it here.
const TURN_PASSES = [
  "autoLabor",
  "lessons",
  "stagedPush",
  "tagExpiry",
  "dyingDeath",
  // Corpses turn before the sweep, and the order is load-bearing: the sweep
  // is a blind deleteMany over expiresTurn, so a body that reached its clock
  // would be deleted instead of rotting. See db/lib/corpseRotPass.js.
  "corpseRot",
  "expirySweep",
  "catatonic",
  "catatonicDeath",
  "bird",
  "hunger",
  "carry",
  // After "carry", because the overflow drop can put a corpse on a floor.
  // Pull-based, so it just re-reads where every body's tag ended up.
  "corpseFollow",
  // The map's own weather. Late on purpose: it must land AFTER "autoLabor" so
  // a day is paid at the coefficients that were live during it, and what this
  // writes is what the next turn's labor is worth.
  "laborYield",
  "lifewebDecay",
];

// How long a resume lease is honoured before another advance may take it
// over — long enough not to steal a live resume, short enough that a killed
// process doesn't wedge the turn.
const RESUME_LEASE_MS = 30 * 60 * 1000;

async function resolveNeeds(turn, config) {
  // Passes already applied — non-empty only when a previous advance died
  // part-way through. See Turn.resolvedPasses in the schema.
  const done = new Set(Array.isArray(turn.resolvedPasses) ? turn.resolvedPasses : []);

  async function markDone(name) {
    done.add(name);
    await prisma.turn
      .update({ where: { id: turn.id }, data: { resolvedPasses: [...done] } })
      .catch((err) => console.error(`Failed to record completed pass "${name}":`, err));
  }

  // A failed pass leaves the turn advancing anyway, logged and left
  // unrecorded so the next advance retries it.
  async function passFailed(name, err) {
    console.error(`${name} pass failed:`, err);
    await prisma.auditLog
      .create({
        data: {
          actorDiscordUserId: "system",
          actionType: "turn_pass_failed",
          details: { turnNumber: turn.number, pass: name, error: String(err?.message ?? err) },
        },
      })
      .catch((logErr) => console.error("Failed to log turn_pass_failed — this failure now has no record:", logErr));
  }

  // Auto-labor first: income has to land before Hunger's upkeep charge, and it
  // must run while the turn is still the one being closed. It also has to run
  // BEFORE the yield drift pass below, so a day's payouts use the coefficients
  // that were live during that day.
  let autoLabor = null;
  if (!done.has("autoLabor")) {
    autoLabor = await runAutoLaborPass(prisma, turn).catch(async (err) => {
      await passFailed("Auto-labor", err);
      return null;
    });
    if (autoLabor) await markDone("autoLabor");
  }
  const { dms: autoLaborDms = [], ...autoLaborSummary } = autoLabor ?? {};
  if (autoLabor?.filed) {
    await prisma.auditLog
      .create({
        data: { actorDiscordUserId: "system", actionType: "auto_labor_resolved", details: autoLaborSummary },
      })
      .catch((err) => console.error("Auto-labor audit log failed:", err));
  }

  // Lessons (db/lib/lessonPass.js): the learner's Gambit is SOLVED here,
  // before the push closes it, and PENDING offers expire. After autoLabor
  // only so a learner who never accepted still worked their day.
  let lessons = null;
  if (!done.has("lessons")) {
    lessons = await runLessonPass(prisma, turn).catch(async (err) => {
      await passFailed("Lessons", err);
      return null;
    });
    if (lessons) await markDone("lessons");
  }
  const { dms: lessonDms = [], ...lessonSummary } = lessons ?? {};
  if (lessons && (lessons.resolved || lessons.expired || lessons.failed)) {
    await prisma.auditLog
      .create({ data: { actorDiscordUserId: "system", actionType: "lessons_resolved", details: lessonSummary } })
      .catch((err) => console.error("Lessons audit log failed:", err));
  }

  // The staged-arbitration push (db/lib/stagedPush.js). Slot is
  // load-bearing: after autoLabor (which stamps appliedEffects), before
  // tagExpiry/expirySweep (a staged grant/cure must land first), and before
  // hunger (deferred Routine/Labor income must land before upkeep).
  let stagedPush = null;
  if (!done.has("stagedPush")) {
    stagedPush = await runStagedPushPass(prisma, turn, config).catch(async (err) => {
      await passFailed("Staged push", err);
      return null;
    });
    if (stagedPush) await markDone("stagedPush");
  }
  const {
    privateDeliveries = [],
    publicPosts = [],
    zoneMoves = [],
    routineNotices = [],
    gambitRollNotices = [],
    ...stagedPushSummary
  } = stagedPush ?? {};
  if (stagedPush) {
    await prisma.auditLog
      .create({
        data: {
          actorDiscordUserId: "system",
          actionType: "staged_push_resolved",
          details: {
            turnNumber: turn.number,
            ...stagedPushSummary,
            privateMessages: privateDeliveries.length,
            publicPosts: publicPosts.length,
            routineNotices: routineNotices.length,
            gambitRollNotices: gambitRollNotices.length,
          },
        },
      })
      .catch((err) => console.error("Staged push audit log failed:", err));
  }

  // Sweeps turn-scoped tag expiry. Progression runs first (grants what an
  // expiring tag turns into), then the sweep deletes exactly what it read.
  // See db/lib/tagExpiryPass.js.
  let progressed = null;
  if (!done.has("tagExpiry")) {
    progressed = await runTagExpiryPass(prisma, turn).catch(async (err) => {
      await passFailed("Tag expiry", err);
      return null;
    });
    if (progressed) await markDone("tagExpiry");
  }
  const { dms: tagExpiryDmsFromProgression = [], ...tagExpirySummary } = progressed ?? {};
  const tagExpiryDms = [...tagExpiryDmsFromProgression];
  if (progressed) {
    await prisma.auditLog
      .create({
        data: { actorDiscordUserId: "system", actionType: "tag_expiry_resolved", details: tagExpirySummary },
      })
      .catch((err) => console.error("Tag expiry audit log failed:", err));
  }

  // Dying death — the engine's second auto-kill, run down from the Dying
  // tag's one-turn clock. After stagedPush/tagExpiry, before the sweep.
  // See db/lib/dyingDeathPass.js.
  let dyingDeath = null;
  if (!done.has("dyingDeath")) {
    dyingDeath = await runDyingDeathPass(prisma, turn).catch(async (err) => {
      await passFailed("Dying death", err);
      return null;
    });
    if (dyingDeath) await markDone("dyingDeath");
  }
  const { deaths: dyingDeaths = [], warnings: dyingDeathWarnings = [], ...dyingDeathSummary } = dyingDeath ?? {};
  if (dyingDeath) {
    await prisma.auditLog
      .create({
        data: { actorDiscordUserId: "system", actionType: "dying_deaths_resolved", details: dyingDeathSummary },
      })
      .catch((err) => console.error("Dying death audit log failed:", err));
  }

  // The Bird's stranded letters (db/lib/birdPass.js), after both auto-kills
  // so a sender who died this turn is already dead when the notice composes.
  let birdResult = null;
  if (!done.has("bird")) {
    birdResult = await runBirdPass(prisma, turn).catch(async (err) => {
      await passFailed("Bird", err);
      return null;
    });
    if (birdResult) await markDone("bird");
  }
  const { notices: birdNotices = [], ...birdSummary } = birdResult ?? {};
  if (birdResult && birdSummary.undelivered > 0) {
    await prisma.auditLog
      .create({
        data: {
          actorDiscordUserId: "system",
          actionType: "bird_messages_undelivered",
          details: birdSummary,
        },
      })
      .catch((err) => console.error("Bird audit log failed:", err));
  }

  // Bodies turn. Must precede the sweep below — see db/lib/corpseRotPass.js.
  if (!done.has("corpseRot")) {
    const rot = await runCorpseRotPass(prisma, turn).catch(async (err) => {
      await passFailed("Corpse rot", err);
      return null;
    });
    if (rot) {
      await markDone("corpseRot");
      if (rot.rotted > 0) {
        await prisma.auditLog
          .create({
            data: { actorDiscordUserId: "system", actionType: "corpses_rotted", details: rot },
          })
          .catch((err) => console.error("Corpse rot audit log failed:", err));
      }
    }
  }

  if (!done.has("expirySweep")) {
    try {
      await prisma.characterTag.deleteMany({
        where: { expiresTurn: { lte: turn.number }, tag: { stackable: false } },
      });
      await sweepExpiredStacks(turn);
      // A stashed tag sheds on the same clock. The one progression that
      // reaches a floor is the corpse rot above, which has already nulled
      // expiresTurn on anything it turned, so this cannot see it.
      await prisma.roomTag.deleteMany({
        where: { expiresTurn: { lte: turn.number }, tag: { stackable: false } },
      });
      await sweepExpiredStacks(turn, "roomTag");
      await markDone("expirySweep");
    } catch (err) {
      await passFailed("Expiry sweep", err);
    }
  }

  // Catatonic (AFK), checked against GameConfig.catatonicTurns. See
  // db/lib/catatonicPass.js.
  let catatonic = null;
  if (!done.has("catatonic")) {
    catatonic = await runCatatonicPass(prisma, turn).catch(async (err) => {
      await passFailed("Catatonic", err);
      return null;
    });
    if (catatonic) await markDone("catatonic");
  }
  const { dms: catatonicDms = [], roleUpdates: catatonicRoleUpdates = [], ...catatonicSummary } = catatonic ?? {};
  if (catatonic) {
    await prisma.auditLog
      .create({
        data: { actorDiscordUserId: "system", actionType: "catatonic_resolved", details: catatonicSummary },
      })
      .catch((err) => console.error("Catatonic audit log failed:", err));
  }

  // Catatonic death — the engine's one auto-kill from inactivity. Its own
  // pass (not a branch of the one above) so a resume can't half-kill.
  // See db/lib/catatonicDeathPass.js.
  let catatonicDeath = null;
  if (!done.has("catatonicDeath")) {
    catatonicDeath = await runCatatonicDeathPass(prisma, turn).catch(async (err) => {
      await passFailed("Catatonic death", err);
      return null;
    });
    if (catatonicDeath) await markDone("catatonicDeath");
  }
  const {
    deaths: catatonicDeaths = [],
    warnings: catatonicDeathWarnings = [],
    ...catatonicDeathSummary
  } = catatonicDeath ?? {};
  if (catatonicDeath) {
    await prisma.auditLog
      .create({
        data: { actorDiscordUserId: "system", actionType: "catatonic_deaths_resolved", details: catatonicDeathSummary },
      })
      .catch((err) => console.error("Catatonic death audit log failed:", err));
  }

  // Hunger upkeep runs after the sweep, so a Hunger granted last close is
  // cleared before this pass can grant a fresh one — otherwise the re-grant
  // collides with @@unique([characterId, tagId]) and gets dropped. See
  // db/lib/hungerPass.js.
  let hunger = null;
  if (!done.has("hunger")) {
    hunger = await runHungerPass(prisma, turn).catch(async (err) => {
      await passFailed("Hunger", err);
      return null;
    });
    if (hunger) await markDone("hunger");
  }

  const { hungerNotices = [], disappointedNotices = [], ...summary } = hunger ?? {};
  if (hunger) {
    await prisma.auditLog
      .create({
        data: { actorDiscordUserId: "system", actionType: "hunger_resolved", details: summary },
      })
      .catch((err) => console.error("Hunger audit log failed:", err));
  }

  // Carry caps: Overburdened on and off, and overflow drops for anyone whose
  // Cart or Pack Mule left during the turn. After hunger so it sees the
  // final sheet. See db/lib/carryPass.js, CARRY.md.
  let carry = null;
  if (!done.has("carry")) {
    carry = await runCarryPass(prisma, turn).catch(async (err) => {
      await passFailed("Carry", err);
      return null;
    });
    if (carry) await markDone("carry");
  }
  const { drops: carryDrops = [], ...carrySummary } = carry ?? {};
  if (carry) {
    await prisma.auditLog
      .create({
        data: { actorDiscordUserId: "system", actionType: "carry_resolved", details: carrySummary },
      })
      .catch((err) => console.error("Carry audit log failed:", err));
  }

  // Every dead sheet catches up with wherever its corpse ended up. Last of
  // the inventory-shaped passes, so it sees the carry drop above.
  if (!done.has("corpseFollow")) {
    const followed = await reconcileCorpses(prisma).catch(async (err) => {
      await passFailed("Corpse follow", err);
      return null;
    });
    if (followed) {
      await markDone("corpseFollow");
      if (followed.length > 0) {
        await prisma.auditLog
          .create({
            data: {
              actorDiscordUserId: "system",
              actionType: "corpses_followed",
              details: { moved: followed.length },
            },
          })
          .catch((err) => console.error("Corpse follow audit log failed:", err));
      }
    }
  }

  // Drift every Location's yield coefficients one turn forward
  // (db/lib/laborYield.js). Random and therefore NOT idempotent, which is
  // exactly why it is a named pass: markDone stops a resumed advance from
  // drifting the whole map twice.
  if (!done.has("laborYield")) {
    const yields = await runLaborYieldPass(prisma, turn).catch(async (err) => {
      await passFailed("Labor yield drift", err);
      return null;
    });
    if (yields) {
      await markDone("laborYield");
      if (yields.drifted) {
        await prisma.auditLog
          .create({ data: { actorDiscordUserId: "system", actionType: "labor_yields_drifted", details: yields } })
          .catch((err) => console.error("Labor yield audit log failed:", err));
      }
    }
  }

  // bumpBlood rather than a computed literal off `config`: that snapshot
  // predates the passes above, so a donation made during the advance would
  // otherwise be discarded by the write-back.
  let lifewebBlood = config?.lifewebBlood ?? 100;
  if (!done.has("lifewebDecay")) {
    try {
      const moved = await bumpBlood(prisma, -(config?.lifewebDecayPerTurn ?? 10));
      lifewebBlood = moved.after;
      await markDone("lifewebDecay");
    } catch (err) {
      await passFailed("Lifeweb decay", err);
    }
  } else {
    const fresh = await prisma.gameConfig.findUnique({ where: { id: 1 } });
    lifewebBlood = fresh?.lifewebBlood ?? lifewebBlood;
  }

  // needsResolvedAt is the sole selector for advanceTurn()'s resume query,
  // so it's only stamped once every pass in TURN_PASSES has run.
  const outstanding = TURN_PASSES.filter((name) => !done.has(name));
  if (outstanding.length === 0) {
    await prisma.turn
      .update({ where: { id: turn.id }, data: { needsResolvedAt: new Date() } })
      .catch((err) => console.error("Failed to stamp needsResolvedAt:", err));
  } else {
    console.error(
      `Turn #${turn.number} finished with ${outstanding.length} pass(es) unapplied: ` +
        `${outstanding.join(", ")}. Leaving needsResolvedAt null so the next advance retries them.`,
    );
  }

  await prisma.turn
    .update({ where: { id: turn.id }, data: { needsResumeClaimedAt: null } })
    .catch((err) => console.error("Failed to release the resume lease:", err));

  return {
    lifewebBlood,
    hungerNotices,
    disappointedNotices,
    autoLaborDms,
    lessonDms,
    tagExpiryDms,
    catatonicDms,
    catatonicRoleUpdates,
    catatonicDeaths,
    catatonicDeathWarnings,
    dyingDeaths,
    dyingDeathWarnings,
    birdNotices,
    carryDrops,
    privateDeliveries,
    publicPosts,
    zoneMoves,
    routineNotices,
    gambitRollNotices,
  };
}

async function getConfig() {
  return prisma.gameConfig.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } });
}

// Resolves the OPEN turn and opens the next, alternating DAWN/DUSK. Shared
// by the bot's cron advance and the GM "End Turn" action. Discord side
// effects are returned as a `runSideEffects()` thunk rather than run here —
// the Dawn wipe can take minutes, so a caller awaits it only where safe
// (the bot's cron inline; the web action via next/server's after()).
//
// Returns { advanced, previousTurn, newTurn, note, runSideEffects }.
// `advanced` is false when another caller won the race to close the open
// turn; callers must check it before using `newTurn`.
async function advanceTurn() {
  const config = await getConfig();
  const openTurn = await prisma.turn.findFirst({ where: { status: "OPEN" } });

  let lifewebBlood = config.lifewebBlood;
  let hungerNotices = [];
  let disappointedNotices = [];
  let autoLaborDms = [];
  let lessonDms = [];
  let tagExpiryDms = [];
  let catatonicDms = [];
  let catatonicRoleUpdates = [];
  let catatonicDeaths = [];
  let catatonicDeathWarnings = [];
  let dyingDeaths = [];
  let dyingDeathWarnings = [];
  let birdNotices = [];
  let carryDrops = [];
  let cavingDms = [];
  let privateDeliveries = [];
  let publicPosts = [];
  let zoneMoves = [];
  let routineNotices = [];
  let gambitRollNotices = [];
  if (openTurn) {
    // Close the turn first, conditioned on it still being OPEN — Postgres
    // serializes the updateMany, so exactly one racing caller sees count===1
    // and the loser bails rather than double-resolving Needs.
    const closed = await prisma.turn.updateMany({
      where: { id: openTurn.id, status: "OPEN" },
      data: { status: "RESOLVED", resolvedAt: new Date() },
    });
    if (closed.count === 0) {
      const winner = await prisma.turn.findFirst({ where: { status: "OPEN" } });
      return {
        advanced: false,
        previousTurn: null,
        newTurn: winner,
        note: null,
        runSideEffects: async () => {},
      };
    }

    ({ lifewebBlood, hungerNotices, disappointedNotices, autoLaborDms, lessonDms, tagExpiryDms, catatonicDms, catatonicRoleUpdates, catatonicDeaths, catatonicDeathWarnings, dyingDeaths, dyingDeathWarnings, birdNotices, carryDrops, privateDeliveries, publicPosts, zoneMoves, routineNotices, gambitRollNotices } =
      await resolveNeeds(openTurn, config));
  } else {
    // No OPEN turn: either this is the first turn ever, or a previous advance
    // claimed the turn and died before creating the next one. A RESOLVED
    // turn with no needsResolvedAt is that crash; finish only its remaining
    // passes.
    const unfinished = await prisma.turn.findFirst({
      where: { status: "RESOLVED", needsResolvedAt: null },
      orderBy: { number: "desc" },
    });
    if (unfinished) {
      // Same compare-and-swap as the normal path, on needsResumeClaimedAt
      // (resolvedPasses is last-write-wins, not a lock). Stale claims are
      // recoverable via RESUME_LEASE_MS.
      const staleBefore = new Date(Date.now() - RESUME_LEASE_MS);
      const claimed = await prisma.turn.updateMany({
        where: {
          id: unfinished.id,
          needsResolvedAt: null,
          OR: [{ needsResumeClaimedAt: null }, { needsResumeClaimedAt: { lt: staleBefore } }],
        },
        data: { needsResumeClaimedAt: new Date() },
      });

      if (claimed.count === 0) {
        console.warn(
          `Turn #${unfinished.number} is already being resumed by another advance — standing down.`,
        );
        return {
          advanced: false,
          previousTurn: null,
          newTurn: null,
          note: null,
          runSideEffects: async () => {},
        };
      }

      console.warn(
        `Turn #${unfinished.number} was claimed but never finished resolving — resuming its outstanding passes.`,
      );
      await prisma.auditLog
        .create({
          data: {
            actorDiscordUserId: "system",
            actionType: "turn_resume",
            details: { turnNumber: unfinished.number, alreadyApplied: unfinished.resolvedPasses ?? [] },
          },
        })
        .catch((logErr) => console.error("Failed to log turn_resume — the resume now has no record:", logErr));
      ({ lifewebBlood, hungerNotices, disappointedNotices, autoLaborDms, lessonDms, tagExpiryDms, catatonicDms, catatonicRoleUpdates, catatonicDeaths, catatonicDeathWarnings, dyingDeaths, dyingDeathWarnings, birdNotices, carryDrops, privateDeliveries, publicPosts, zoneMoves, routineNotices, gambitRollNotices } =
        await resolveNeeds(unfinished, config));
    }
  }

  const lastTurn = openTurn ?? (await prisma.turn.findFirst({ orderBy: { number: "desc" } }));
  const phase = !lastTurn || lastTurn.phase === "DUSK" ? "DAWN" : "DUSK";
  // A GM override (config.nextWeather) always wins over the rolled weather.
  const weather = config.nextWeather ?? rollWeather(lastTurn?.weather, phase);
  const lifewebFlavor = lifewebBlood <= LIFEWEB_SPUTTER_THRESHOLD ? "The Lifeweb sputters, failing." : null;
  const note = [lifewebFlavor, config.nextTurnNote].filter(Boolean).join("\n\n") || null;

  const newTurn = await prisma.turn.create({
    data: { number: (lastTurn?.number ?? 0) + 1, phase, weather, gameDate: new Date(), status: "OPEN" },
  });

  await prisma.gameConfig.update({
    where: { id: 1 },
    data: { nextWeather: null, nextTurnNote: null },
  });

  await recordArchiveEvent(prisma, {
    kind: "TURN_START",
    turn: newTurn,
    content: [`Day ${Math.ceil(newTurn.number / 2)} — ${newTurn.phase}`, weather, note]
      .filter(Boolean)
      .join("\n"),
  });

  // The Caving Die rolls against the turn that just opened, not the one being
  // closed — an arrival roll earlier the same turn must not claim the row
  // first. See db/lib/cavingPass.js, CAVING.md §2. Own try/catch that must
  // never rethrow: a throw here would abort advanceTurn() with newTurn
  // already created but no announcement.
  try {
    const caving = await runCavingPass(prisma, newTurn);
    const { dms, ...cavingSummary } = caving;
    cavingDms = dms;
    await prisma.auditLog
      .create({
        data: {
          actorDiscordUserId: "system",
          actionType: "caving_resolved",
          details: { turnNumber: newTurn.number, ...cavingSummary },
        },
      })
      .catch((err) => console.error("Caving audit log failed:", err));
  } catch (err) {
    console.error("Caving pass failed:", err);
    await prisma.auditLog
      .create({
        data: {
          actorDiscordUserId: "system",
          actionType: "turn_pass_failed",
          details: { turnNumber: newTurn.number, pass: "caving", error: String(err?.message ?? err) },
        },
      })
      .catch((logErr) => console.error("Failed to log turn_pass_failed for caving:", logErr));
  }

  // Everything below this line is the only place in the turn-advance path
  // that talks to Discord; every resolveNeeds() pass hands back posts/DMs
  // instead of sending them.
  const runSideEffects = async () => {
    // Cutoff for the Dawn wipe below, taken before the first Discord call so
    // nothing posted by this thunk gets swept. See db/lib/dawnWipe.js.
    const sideEffectsStartedAt = Date.now();

    for (const dm of autoLaborDms) {
      await sendDm(prisma, dm.discordUserId, dm.content).catch((err) =>
        console.error(`Auto-labor DM to ${dm.discordUserId} failed:`, err),
      );
    }

    for (const dm of lessonDms) {
      await sendDm(prisma, dm.discordUserId, dm.content).catch((err) =>
        console.error(`Lesson DM to ${dm.discordUserId} failed:`, err),
      );
    }

    for (const dm of tagExpiryDms) {
      await sendDm(prisma, dm.discordUserId, dm.content).catch((err) =>
        console.error(`Tag progression DM to ${dm.discordUserId} failed:`, err),
      );
    }

    for (const dm of birdNotices) {
      await sendDm(prisma, dm.discordUserId, dm.content).catch((err) =>
        console.error(`Bird failure DM to ${dm.discordUserId} failed:`, err),
      );
    }

    for (const result of carryDrops) {
      await deliverCarryDrop(prisma, result).catch((err) =>
        console.error(`Carry drop delivery for ${result.characterId} failed:`, err),
      );
    }

    for (const dm of catatonicDms) {
      await sendDm(prisma, dm.discordUserId, dm.content).catch((err) =>
        console.error(`Catatonic DM to ${dm.discordUserId} failed:`, err),
      );
    }

    for (const update of catatonicRoleUpdates) {
      await patchGuildRole(update.roleId, { name: update.name, color: update.color }).catch((err) =>
        console.error(`Catatonic role rename for ${update.name} failed:`, err),
      );
    }

    for (const warning of [...catatonicDeathWarnings, ...dyingDeathWarnings]) {
      await sendDm(prisma, warning.discordUserId, warning.content).catch((err) =>
        console.error(`Death warning DM to ${warning.discordUserId} failed:`, err),
      );
    }

    const turnDeaths = [...catatonicDeaths, ...dyingDeaths];

    // Same teardown web/lib/discordGuild.js#killCharacter performs, plus a
    // membership check up front so a departed player's steps don't just 403
    // into the REST breaker's tally.
    for (const death of turnDeaths) {
      const member = await getGuildMember(death.discordUserId).catch((err) => {
        console.error(`Membership check for ${death.name} failed:`, err);
        return null;
      });

      const revoked = await revokeAllCharacterAccess(prisma, death).catch((err) => {
        console.error(`Failed to revoke access for ${death.name} on an automatic death:`, err);
        return null;
      });
      if (!revoked || revoked.failed > 0) {
        await prisma.auditLog
          .create({
            data: {
              actorDiscordUserId: "system",
              actionType: "access_revoke_incomplete",
              targetCharacterId: death.characterId,
              targetName: death.name,
              details: { failed: revoked?.failed ?? null, attempted: revoked?.attempted ?? null },
            },
          })
          .catch((err) => console.error("Failed to log an incomplete access revoke:", err));
      }

      if (death.discordRoleId) {
        await deleteGuildRole(death.discordRoleId).catch((err) =>
          console.error(`Failed to delete ${death.name}'s role on an automatic death:`, err.message),
        );
      }

      if (member) {
        if (process.env.DISCORD_CURSED_ROLE_ID) {
          await addMemberRole(death.discordUserId, process.env.DISCORD_CURSED_ROLE_ID).catch((err) =>
            console.error(`Failed to grant Cursed to ${death.discordUserId}:`, err.message),
          );
        }
        await setGuildNickname(death.discordUserId, null).catch((err) =>
          console.error(`Failed to clear ${death.name}'s nickname:`, err.message),
        );
        await sendDm(prisma, death.discordUserId, `You have died. ${death.reason}`).catch((err) =>
          console.error(`Death DM to ${death.discordUserId} failed:`, err),
        );
      }
    }
    if (turnDeaths.length > 0) {
      await postMessage(
        LEAVE_ANNOUNCE_CHANNEL_ID,
        turnDeaths.map((death) => `${death.name} has died — ${death.reason}`).join("\n"),
      ).catch((err) => console.error("Automatic-death alert to #leave failed:", err));
    }

    for (const dm of cavingDms) {
      await sendDm(prisma, dm.discordUserId, dm.content).catch((err) =>
        console.error(`Caving DM to ${dm.discordUserId} failed:`, err),
      );
    }

    for (const notice of hungerNotices) {
      await sendDm(prisma, notice.discordUserId, hungerDm(notice)).catch((err) =>
        console.error(`Hunger DM to ${notice.discordUserId} failed:`, err),
      );
      if (notice.justDied) {
        await sendDm(prisma, notice.discordUserId, DYING_DM).catch((err) =>
          console.error(`Dying DM to ${notice.discordUserId} failed:`, err),
        );
      }
    }

    for (const notice of disappointedNotices) {
      await sendDm(prisma, notice.discordUserId, disappointedDm(notice)).catch((err) =>
        console.error(`Disappointed DM to ${notice.discordUserId} failed:`, err),
      );
    }

    const { applyLocationMoveSideEffects } = require("./lib/locationMove");
    for (const move of zoneMoves) {
      await applyLocationMoveSideEffects(prisma, move).catch((err) =>
        console.error(`Staged relocation side effects failed for ${move.characterId}:`, err),
      );
    }

    // Staged-arbitration deliveries (docs/systemdocs/ADJUDICATION.md).
    // sentAt is stamped only after sends were attempted, so a crash partway
    // leaves the remainder visibly unsent instead of falsely delivered.
    const deliveryFailures = [];
    for (const delivery of privateDeliveries) {
      const failed = [];
      for (const recipient of delivery.recipients) {
        try {
          await sendDm(prisma, recipient.discordUserId, delivery.content, {
            authorDiscordUserId: delivery.createdByDiscordUserId ?? null,
            source: "staged_push",
          });
        } catch (err) {
          failed.push({
            characterId: recipient.characterId,
            name: recipient.name,
            error: String(err?.message ?? err),
          });
        }
      }
      await prisma.stagedMessage
        .update({
          where: { id: delivery.stagedMessageId },
          data: { sentAt: new Date(), deliveryFailures: failed.length ? failed : Prisma.DbNull },
        })
        .catch((err) => console.error(`Failed to stamp staged message ${delivery.stagedMessageId} sent:`, err));
      if (failed.length) deliveryFailures.push({ stagedMessageId: delivery.stagedMessageId, failed });
    }

    for (const notice of routineNotices) {
      await sendDm(prisma, notice.discordUserId, notice.content).catch((err) =>
        console.error(`Passed-Routine DM to ${notice.discordUserId} failed:`, err),
      );
    }

    for (const notice of gambitRollNotices) {
      await sendDm(prisma, notice.discordUserId, notice.content).catch((err) =>
        console.error(`Gambit roll DM to ${notice.discordUserId} failed:`, err),
      );
    }

    for (const post of publicPosts) {
      const targetChannelId = post.zoneSummaryChannelId;
      if (!targetChannelId) {
        console.error(`Public declaration ${post.stagedMessageId} skipped: its zone has no summary channel.`);
        await prisma.stagedMessage
          .update({
            where: { id: post.stagedMessageId },
            data: { deliveryFailures: [{ error: "no summary channel configured" }] },
          })
          .catch((err) => console.error(`Failed to mark public post ${post.stagedMessageId}:`, err));
        deliveryFailures.push({ stagedMessageId: post.stagedMessageId, failed: [{ error: "no summary channel configured" }] });
        continue;
      }
      try {
        // Batched: a declaration over 2000 characters posts as several
        // messages in order rather than being rejected. See ADJUDICATION.md §1.
        await postMessageBatched(targetChannelId, post.content);
        await prisma.stagedMessage
          .update({
            where: { id: post.stagedMessageId },
            data: { sentAt: new Date(), deliveryFailures: Prisma.DbNull },
          })
          .catch((err) => console.error(`Failed to stamp public post ${post.stagedMessageId} sent:`, err));
      } catch (err) {
        console.error(`Public declaration ${post.stagedMessageId} failed to post:`, err);
        await prisma.stagedMessage
          .update({
            where: { id: post.stagedMessageId },
            data: { deliveryFailures: [{ error: String(err?.message ?? err) }] },
          })
          .catch((markErr) => console.error(`Failed to mark public post ${post.stagedMessageId}:`, markErr));
        deliveryFailures.push({ stagedMessageId: post.stagedMessageId, failed: [{ error: String(err?.message ?? err) }] });
      }
    }

    if (deliveryFailures.length) {
      await prisma.auditLog
        .create({
          data: {
            actorDiscordUserId: "system",
            actionType: "staged_push_delivery_failed",
            details: { failures: deliveryFailures },
          },
        })
        .catch((err) => console.error("Failed to log staged_push_delivery_failed:", err));
    }

    await postTurnsAnnouncement(prisma, newTurn, note).catch((err) =>
      console.error("Failed to post turn announcement:", err),
    );

    if (newTurn.phase === "DAWN" && config.messageWipeEnabled) {
      await runDawnWipe(prisma, { cutoffMs: sideEffectsStartedAt }).catch((err) =>
        console.error("Dawn message wipe failed:", err),
      );
    }

    if (config.autoReconcileEnabled) {
      const { runChannelDoctor } = require("./lib/channelDoctor");
      await runChannelDoctor(prisma, { apply: true, scope: "cheap" }).catch((err) =>
        console.error("Post-turn channel doctor failed:", err),
      );
    }
  };

  return { advanced: true, previousTurn: openTurn, newTurn, note, runSideEffects };
}

module.exports = {
  prisma,
  // Prisma.DbNull is the only way to write a SQL NULL into a nullable Json
  // column — a plain null is a validation error.
  Prisma,
  resolveNeeds,
  advanceTurn,
  runFullChannelWipe,
  syncZonesFromYaml,
  syncTagsFromYaml,
  deleteCharacterRow,
  syncRolesFromYaml,
  syncDesiresFromYaml,
  syncDocumentsFromYaml,
  SPECIAL_CHANNELS,
  NARROWCAST_SLUGS,
  buildNarrowcastContext,
  computeNarrowcastAccess,
  syncSpecialChannels,
  ...require("./lib/seatZone"),
  LIFEWEB_SPUTTER_THRESHOLD,
  ...require("./weather"),
  ...require("./lib/constants"),
  ...require("./lib/roleIds"),
  ...require("./lib/roleColor"),
  ...require("./lib/characterRoleAppearance"),
  ...require("./lib/characterName"),
  ...require("./lib/titles"),
  ...require("./lib/nameCorpus"),
  ...require("./lib/dynasty"),
  ...require("./lib/concealedIdentity"),
  ...require("./lib/presentedIdentity"),
  ...require("./lib/antagonists"),
  ...require("./lib/roleCapacity"),
  ...require("./lib/production"),
  ...require("./lib/depot"),
  ...require("./lib/locationAttributes"),
  ...require("./lib/formatTagRequirement"),
  ...require("./lib/turnFormat"),
  ...require("./lib/turnClock"),
  ...require("./lib/lifeweb"),
  ...require("./lib/gambitModifier"),
  ...require("./lib/moveEffects"),
  ...require("./lib/resourceDelta"),
  ...require("./lib/laborAccess"),
  ...require("./lib/laborYield"),
  // Only the pure helper — the revoke functions take prisma as a parameter
  // and are kept off the barrel; require db/lib/accessSweep.js by path.
  zoneChannelIds: require("./lib/accessSweep").zoneChannelIds,
};
