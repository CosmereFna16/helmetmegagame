// Some launchers export DATABASE_URL with its .env quotes still attached
// (`DATABASE_URL="postgres://..."`), which Prisma rejects with a baffling
// "the URL must start with the protocol postgresql://". Strip one matched
// pair of surrounding quotes. This has to happen BEFORE @prisma/client is
// required — the generated client snapshots its datasource env at module
// load, so fixing it afterwards is too late. This is the single place the
// client is constructed for the bot, the web app, and every script.
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
const { runTagExpiryPass } = require("./lib/tagExpiryPass");
// By path, not the barrel — same reason as db/lib/dm.js below.
const { runDawnWipe } = require("./lib/dawnWipe");
const { runThreadExpiry } = require("./lib/threadExpiryPass");
const { runHungerPass, hungerDm, disappointedDm, DYING_DM } = require("./lib/hungerPass");
const { runCatatonicPass } = require("./lib/catatonicPass");
const { runCatatonicDeathPass } = require("./lib/catatonicDeathPass");
const { runDyingDeathPass } = require("./lib/dyingDeathPass");
const { runBirdPass } = require("./lib/birdPass");
// By path, not the barrel — see the note at the top of db/lib/accessSweep.js.
const { revokeAllCharacterAccess } = require("./lib/accessSweep");
const { LEAVE_ANNOUNCE_CHANNEL_ID } = require("./lib/constants");
const { runCavingPass } = require("./lib/cavingPass");
const { runDefaultMovePass } = require("./lib/defaultMovePass");
const { runStagedPushPass } = require("./lib/stagedPush");
// Required by path, not through the barrel: see the note in db/lib/dm.js about
// why there are three same-named sendDm exports with three signatures.
const { sendDm } = require("./lib/dm");
const { recordArchiveMessage, recordArchiveEvent } = require("./lib/archive");
const { postAsCharacter, postMessage, postMessageBatched, attachBreakerStore, patchGuildRole, deleteGuildRole, addMemberRole, getGuildMember, setGuildNickname } = require("./lib/discordRest");
const { bumpBlood } = require("./lib/lifeweb");
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

// The globalThis cache is deliberately NOT gated on NODE_ENV. The usual
// `if (NODE_ENV !== "production")` idiom exists to survive dev hot-reload, and
// gating it here was actively wrong: Turbopack bundles @lifeweb/db as
// first-party source (same reason __dirname gets inlined — ARCHITECTURE.md
// §2), so the production web build carries this module in two separate chunks
// with two separate module registries. Gated, that meant two PrismaClients per
// web container, each opening its own pool. Caching unconditionally collapses
// them back to one.
//
// transactionOptions raises Prisma's defaults (maxWait 2s, timeout 5s), which
// are too tight for the per-character interactive transactions in
// db/lib/defaultMovePass.js: at turn rollover those compete with player writes
// for both pool slots and row locks, and a 2s maxWait means a player's Default
// Move gets dropped on the floor with only a console.error (the catch at
// defaultMovePass.js#run).
const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    ...(databaseUrl ? { datasourceUrl: databaseUrl } : {}),
    transactionOptions: { maxWait: 5000, timeout: 15000 },
    // Character.avatarData is a 10-25 KB WebP blob, and it is served
    // out-of-band by web/app/api/avatar/[characterId]/route.js — no page ever
    // needs the bytes inline. But `include` returns every scalar, so
    // /gm/turns' 500 Actions x full character row was reading ~12 MB of
    // portraits out of Postgres per page load, and /character was base64ing
    // one into the RSC payload of every render on top of the <img> that
    // already fetched it.
    //
    // Omitting globally rather than per-query is deliberate: it fixes all four
    // call sites at once and, more importantly, means a future `include` can't
    // silently reintroduce the problem. An explicit `select: { avatarData:
    // true }` still overrides it, which is exactly how the avatar route reads
    // the bytes. Anything needing only "does this character have a portrait?"
    // should read avatarMimeType, which is written and nulled in lockstep with
    // the blob (web/app/(app)/character/actions.js).
    omit: { character: { avatarData: true } },
  });

globalForPrisma.prisma = prisma;

// Hands the Discord circuit breaker somewhere durable to keep its counters.
//
// It lives here rather than in discordRest.js because that file deliberately
// has no prisma dependency — db/index.js is the one requiring IT, so requiring
// back would resolve to a partial exports object (same reason db/lib/dm.js
// takes prisma as a parameter). Passing two functions instead keeps the
// direction of the dependency intact.
//
// Neither is on the hot path: read runs once per process, write only when an
// invalid response has already happened.
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
  // updateMany rather than update: on a brand-new database GameConfig may not
  // exist yet, and failing to record a rate-limit count is not a reason to
  // create the game's config row as a side effect.
  write: (data) => prisma.gameConfig.updateMany({ where: { id: 1 }, data }),
});

// Below this, the turn announcement gets a vague public omen line (see
// advanceTurn() below) without ever naming the actual number — the Blood
// value itself stays visible only to Mortus-tagged characters and GMs
// (web/app/(app)/lifeweb/page.js).
const LIFEWEB_SPUTTER_THRESHOLD = 20;

// The stackable half of resolveNeeds()' expiry sweep: every expired stack
// loses exactly one unit, and whatever is left gets its clock restarted from
// the tag's catalog duration — so three two-turn rations shed one every two
// turns rather than all three at once. The last unit takes the row with it,
// since quantity may never fall below 1. Kept to a bounded number of
// statements (one delete, one update per distinct new expiry) rather than a
// query per row: durations come from a tiny catalog, so this is a couple of
// statements however many characters are holding stacks.
async function sweepExpiredStacks(turn) {
  const expired = await prisma.characterTag.findMany({
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
    // Same absolute-turn expression as db/lib/hungerPass.js, so both writers
    // derive expiry identically.
    const next = expiryFrom(turn.number + 1, ct.tag.defaultDurationTurns ?? 1);
    if (!rescheduled.has(next)) rescheduled.set(next, []);
    rescheduled.get(next).push(ct.id);
  }

  await prisma.$transaction([
    ...(spent.length ? [prisma.characterTag.deleteMany({ where: { id: { in: spent } } })] : []),
    // decrement rather than a computed literal, so a concurrent grant on the
    // same row can't be clobbered between the read above and this write.
    ...[...rescheduled].map(([expiresTurn, ids]) =>
      prisma.characterTag.updateMany({
        where: { id: { in: ids } },
        data: { quantity: { decrement: 1 }, expiresTurn },
      }),
    ),
  ]);
}

// Applies per-turn Needs decay to the turn being closed. Shared between the
// bot's cron-triggered advanceTurn() and the GM dashboard's manual
// close-turn override, so both paths behave identically.
//
// Returns { lifewebBlood, hungerNotices, disappointedNotices,
// defaultMovePosts, defaultMoveDms, tagExpiryDms, catatonicDms,
// catatonicRoleUpdates, catatonicDeaths, catatonicDeathWarnings }. Everything
// after the first is Discord work this function deliberately does NOT
// perform — see advanceTurn() below for why.
//
// The Caving Die is NOT one of this function's passes: resolveNeeds() only
// ever runs against the turn being CLOSED, and the die must roll for the turn
// that's OPENING (see db/lib/cavingPass.js and CAVING.md §2). advanceTurn()
// below runs it directly against the newly created turn instead.
//
// Every pass this turn owes, by the name markDone records it under. The
// needsResolvedAt stamp at the bottom is written only when `done` covers all
// of them, which is what makes the resume machinery mean anything.
const TURN_PASSES = [
  "defaultMoves",
  "stagedPush",
  "tagExpiry",
  "dyingDeath",
  "expirySweep",
  "catatonic",
  "catatonicDeath",
  "bird",
  "hunger",
  "lifewebDecay",
];

// How long a resume lease is honoured before another advance may take it over.
// Long enough that a real resume of a 100+ player roster is never stolen
// mid-flight, short enough that a process killed while holding one doesn't
// strand the turn until someone notices by hand.
const RESUME_LEASE_MS = 30 * 60 * 1000;

async function resolveNeeds(turn, config) {
  // Which passes this turn has already had applied. Non-empty only when a
  // previous advance claimed the turn and then died part-way through it; see
  // Turn.resolvedPasses in the schema for why re-running the lot is not an
  // option.
  const done = new Set(Array.isArray(turn.resolvedPasses) ? turn.resolvedPasses : []);

  async function markDone(name) {
    done.add(name);
    await prisma.turn
      .update({ where: { id: turn.id }, data: { resolvedPasses: [...done] } })
      .catch((err) => console.error(`Failed to record completed pass "${name}":`, err));
  }

  // A failed pass leaves the turn advancing anyway — a stuck turn is worse
  // than a missed upkeep — but it's logged rather than vanishing into stderr,
  // and stays unrecorded so the next advance retries it.
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
      // Not a bare .catch(() => {}). This row is the ONLY durable trace that a
      // pass failed; losing it silently means the stderr line above is all
      // that ever existed, and by then nobody is watching.
      .catch((logErr) => console.error("Failed to log turn_pass_failed — this failure now has no record:", logErr));
  }

  // Default Moves file FIRST: a Default Move can pay resources in, and the
  // Hunger pass below charges them out, so income has to land before upkeep
  // or a player whose default earns them a meal still goes hungry. It also
  // has to run while the turn is still the one being closed — it files a
  // real Action against it.
  let defaults = null;
  if (!done.has("defaultMoves")) {
    defaults = await runDefaultMovePass(prisma, turn).catch(async (err) => {
      await passFailed("Default Move", err);
      return null;
    });
    if (defaults) await markDone("defaultMoves");
  }
  // Same split as the Hunger pass below: the posts/DMs the pass wants are
  // routing data for runSideEffects(), not part of the turn's record, so they
  // come off before the audit row is written.
  const { posts: defaultMovePosts = [], dms: defaultMoveDms = [], ...defaultSummary } = defaults ?? {};
  if (defaults?.filed) {
    await prisma.auditLog
      .create({
        data: { actorDiscordUserId: "system", actionType: "default_moves_resolved", details: defaultSummary },
      })
      .catch((err) => console.error("Default Move audit log failed:", err));
  }

  // The staged-arbitration push — everything the GMs queued this turn, plus
  // every confirmed Move's own declared payout (see db/lib/stagedPush.js).
  // Its slot here is load-bearing three ways:
  //   - AFTER defaultMoves: that pass stamps appliedEffects on the Actions it
  //     files, so this one correctly skips them, and its income is already
  //     positioned before upkeep.
  //   - BEFORE tagExpiry/expirySweep: a staged "remove Infected" must beat
  //     the progression that would turn it into Festering, and a staged fresh
  //     grant carries expiresTurn > turn.number so the sweep can't eat it.
  //   - BEFORE hunger: deferred Routine and Labor-checkbox income has to land
  //     before upkeep is charged, or every laborer who banked their last ⬢ on
  //     paper goes hungry — the same income-before-upkeep rule that puts
  //     defaultMoves first.
  let stagedPush = null;
  if (!done.has("stagedPush")) {
    stagedPush = await runStagedPushPass(prisma, turn, config).catch(async (err) => {
      await passFailed("Staged push", err);
      return null;
    });
    if (stagedPush) await markDone("stagedPush");
  }
  // Same split as every pass here: the deliveries are routing data for
  // runSideEffects(), not part of the turn's record.
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

  // Sweep any turn-scoped tags whose expiresTurn has been reached,
  // independent of everything else here. Two passes, because a stack is ONE
  // CharacterTag row carrying a count rather than N rows (see
  // web/lib/requestEffects.js): an ordinary tag (Drained, Tipsy, last turn's
  // Hunger) is deleted outright, but a stackable one only sheds a single
  // unit per expiry and rerolls the remainder's timer — otherwise one
  // ration's clock coming due would wipe the character's whole holding.
  //
  // The progression pass goes FIRST, because the deleteMany below is blind:
  // once it has run there is nothing left to read. It grants what each
  // expiring tag turns into (Infected -> Festering, Necrosis -> a limb) and
  // deletes nothing itself, leaving the sweep to remove exactly the rows it
  // just read. Nothing in it kills anyone — the terminal chains stop at the
  // Dying tag, and the Dying death pass below is what ends it a turn later.
  // See db/lib/tagExpiryPass.js.
  let progressed = null;
  if (!done.has("tagExpiry")) {
    progressed = await runTagExpiryPass(prisma, turn).catch(async (err) => {
      await passFailed("Tag expiry", err);
      return null;
    });
    if (progressed) await markDone("tagExpiry");
  }
  // Same split as the two passes either side: the DMs are routing data for
  // runSideEffects(), not part of the turn's record.
  const { dms: tagExpiryDmsFromProgression = [], ...tagExpirySummary } = progressed ?? {};
  const tagExpiryDms = [...tagExpiryDmsFromProgression];
  if (progressed) {
    await prisma.auditLog
      .create({
        data: { actorDiscordUserId: "system", actionType: "tag_expiry_resolved", details: tagExpirySummary },
      })
      .catch((err) => console.error("Tag expiry audit log failed:", err));
  }

  // Dying death — the engine's second auto-kill. Dying carries a one-turn
  // clock (docs/tags.yaml), and this is what the clock runs down to. Its slot
  // is load-bearing on both sides: AFTER stagedPush and tagExpiry
  // so a staged cure or a medic's heal landing this same close always beats
  // the axe, and BEFORE the sweep below, which would otherwise delete the very
  // rows that are the evidence. Own resolvedPasses marker for the same reason
  // catatonicDeath has one — a destructive pass must not half-run on a resume.
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
    // Names ride in the details for the same reason the Catatonic death row
    // carries them: this is a pass whose per-character outcome a GM has to be
    // able to reconstruct from the log alone.
    await prisma.auditLog
      .create({
        data: { actorDiscordUserId: "system", actionType: "dying_deaths_resolved", details: dyingDeathSummary },
      })
      .catch((err) => console.error("Dying death audit log failed:", err));
  }

  // The Bird's stranded letters (db/lib/birdPass.js). Deliberately late in the
  // close, after both auto-kills: a sender who died this same turn is already
  // dead by the time the notice is composed, so the two cannot disagree about
  // whether to write to them. Its own resolvedPasses marker like every other
  // pass — the failureNotifiedAt stamp it writes IS the claim, so a resume must
  // not be able to tell the same sender twice.
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

  // Paired with the progression pass above and recorded as one unit: the
  // sweep is what deletes the rows that pass just read, so resuming with one
  // applied and the other not would either double-progress or strand expired
  // tags on every sheet.
  if (!done.has("expirySweep")) {
    try {
      await prisma.characterTag.deleteMany({
        where: { expiresTurn: { lte: turn.number }, tag: { stackable: false } },
      });
      await sweepExpiredStacks(turn);
      await markDone("expirySweep");
    } catch (err) {
      await passFailed("Expiry sweep", err);
    }
  }

  // Catatonic (AFK) — every ALIVE character's activity clock checked against
  // GameConfig.catatonicTurns. Slotted after expirySweep for the same reason
  // tagExpiry -> expirySweep -> hunger is ordered below: it reads/writes
  // CharacterTag rows and must not race the sweep over the same table.
  // Ordering against caving/hunger doesn't matter — this pass doesn't touch
  // resources or Hunger's streak. See db/lib/catatonicPass.js.
  let catatonic = null;
  if (!done.has("catatonic")) {
    catatonic = await runCatatonicPass(prisma, turn).catch(async (err) => {
      await passFailed("Catatonic", err);
      return null;
    });
    if (catatonic) await markDone("catatonic");
  }
  // roleUpdates is pulled out alongside the DMs so neither lands in the
  // audit row's details — the summary is counts, not a Discord work list.
  const { dms: catatonicDms = [], roleUpdates: catatonicRoleUpdates = [], ...catatonicSummary } = catatonic ?? {};
  if (catatonic) {
    await prisma.auditLog
      .create({
        data: { actorDiscordUserId: "system", actionType: "catatonic_resolved", details: catatonicSummary },
      })
      .catch((err) => console.error("Catatonic audit log failed:", err));
  }

  // Catatonic death — pass 7b, the engine's one auto-kill (see
  // db/lib/catatonicDeathPass.js for the reversal of the "nothing automatic
  // ends a character" rule, and for why it is its own pass rather than a
  // branch of the one above: it must run strictly AFTER the clear branch, so
  // a character who woke this close can never be killed by it, and a
  // destructive pass gets its own resolvedPasses marker so a resume can't
  // half-kill). DB writes happen in the pass; the Discord teardown — access
  // revoke, role delete, conditional Cursed grant, DMs, the #leave alert —
  // rides back on `deaths` for runSideEffects().
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
    // One summary row per turn like every pass — but names ride in the
    // details, because this is the one pass whose per-character outcome a GM
    // must be able to reconstruct from the log alone.
    await prisma.auditLog
      .create({
        data: { actorDiscordUserId: "system", actionType: "catatonic_deaths_resolved", details: catatonicDeathSummary },
      })
      .catch((err) => console.error("Catatonic death audit log failed:", err));
  }

  // Hunger upkeep runs AFTER the sweep, deliberately: a Hunger granted while
  // closing turn N-1 carries expiresTurn N, so the sweep is what clears it a
  // moment before this pass may grant a fresh one. In the other order a
  // still-broke character's re-grant would collide with
  // @@unique([characterId, tagId]) and be silently dropped, leaving them
  // holding a tag that expires immediately. See db/lib/hungerPass.js.
  //
  // One summary audit row rather than one per character: at 100+ players a
  // per-character row would push 200 entries a day into /gm/audit and drown
  // every human-authored line. Written here rather than by the two advance
  // callers because the whole point of resolveNeeds being shared is that both
  // paths resolve Needs identically.
  let hunger = null;
  if (!done.has("hunger")) {
    hunger = await runHungerPass(prisma, turn).catch(async (err) => {
      await passFailed("Hunger", err);
      return null;
    });
    if (hunger) await markDone("hunger");
  }

  // The DM list is split off the summary before it's logged: it's routing
  // data for runSideEffects(), not part of the turn's record, so the audit
  // details stay exactly the shape they've always been.
  const { hungerNotices = [], disappointedNotices = [], ...summary } = hunger ?? {};
  if (hunger) {
    await prisma.auditLog
      .create({
        data: { actorDiscordUserId: "system", actionType: "hunger_resolved", details: summary },
      })
      .catch((err) => console.error("Hunger audit log failed:", err));
  }

  // The Lifeweb bleeds out a fixed amount every turn regardless of what fed
  // it last — see donateBlood()/feedLifewebPerson() in
  // web/app/(app)/lifeweb/actions.js for the ways it's topped back up.
  //
  // bumpBlood rather than a computed literal off `config`: that snapshot was
  // read before the passes above ran, so any blood donated during the advance
  // was being silently discarded by the write-back.
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

  // Every pass accounted for. A turn carrying this is one no resume will
  // reopen — must stay conditional on every pass in TURN_PASSES having run,
  // since needsResolvedAt is the sole selector for advanceTurn()'s resume
  // query. Stamping it unconditionally means a failed pass is written off as
  // resolved and never retried.
  //
  // The turn still advances either way — a stuck turn is worse than a missed
  // upkeep — but the missed upkeep now gets picked up by the next advance.
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

  // Released whether or not every pass landed: the lease says "someone is
  // working on this", and nobody is any more. needsResolvedAt above is the
  // separate question of whether the work is finished.
  await prisma.turn
    .update({ where: { id: turn.id }, data: { needsResumeClaimedAt: null } })
    .catch((err) => console.error("Failed to release the resume lease:", err));

  return {
    lifewebBlood,
    hungerNotices,
    disappointedNotices,
    defaultMovePosts,
    defaultMoveDms,
    tagExpiryDms,
    catatonicDms,
    catatonicRoleUpdates,
    catatonicDeaths,
    catatonicDeathWarnings,
    dyingDeaths,
    dyingDeathWarnings,
    birdNotices,
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

// Resolves the currently OPEN turn (applying Needs decay) and opens the next
// one, alternating DAWN/DUSK. Shared by the bot's cron-triggered advance and
// any GM-triggered "End Turn" action so both apply identical turn logic.
//
// This composes every Discord side effect (the Hunger DMs, the turn
// announcement, and the Dawn message wipe if enabled — all REST-based, see
// db/lib/turnAnnouncement.js and db/lib/dawnWipe.js), but does not *run*
// them: they're returned as a single `runSideEffects()` thunk and the caller
// decides when. The wipe walks every location, thread and message page
// sequentially and can take minutes, so awaiting it inside a server action
// would freeze the web app behind a pending request. The bot's cron awaits
// the thunk inline (a background process, so the wait is harmless); the web
// action runs it via next/server's after(), so the response is flushed
// first. Everything inside is best-effort: individually caught, never thrown.
//
// Returns { advanced, previousTurn, newTurn, note, runSideEffects }. `advanced`
// is false when another caller won the race to close the open turn (see the
// guard below) — this call did nothing, and `newTurn` is then whatever the
// winner opened, or null if it hasn't got that far yet. Callers must check
// `advanced` before logging or dereferencing `newTurn`; a null `previousTurn`
// on its own is ambiguous, since opening the very first turn has one too.
async function advanceTurn() {
  const config = await getConfig();
  const openTurn = await prisma.turn.findFirst({ where: { status: "OPEN" } });

  let lifewebBlood = config.lifewebBlood;
  let hungerNotices = [];
  let disappointedNotices = [];
  let defaultMovePosts = [];
  let defaultMoveDms = [];
  let tagExpiryDms = [];
  let catatonicDms = [];
  let catatonicRoleUpdates = [];
  let catatonicDeaths = [];
  let catatonicDeathWarnings = [];
  let dyingDeaths = [];
  let dyingDeathWarnings = [];
  let birdNotices = [];
  let cavingDms = [];
  let privateDeliveries = [];
  let publicPosts = [];
  let zoneMoves = [];
  let routineNotices = [];
  let gambitRollNotices = [];
  if (openTurn) {
    // Close the turn FIRST, conditioned on it still being OPEN. This is the
    // guard against two advances racing — a GM double-clicking End turn, or
    // clicking it just as the bot's twice-daily cron fires. Postgres
    // serializes the two updateMany's, so exactly one sees count === 1; the
    // loser bails out here instead of resolving Needs a second time and
    // opening a duplicate turn.
    //
    // Closing before resolving is what makes the claim atomic. The cost is
    // that a mid-resolve crash leaves the turn RESOLVED with Needs half-
    // applied; the alternative — resolving before closing — lets a losing
    // racer run the whole of resolveNeeds() before finding out it lost,
    // double-charging upkeep and double-decaying the Lifeweb. A half-resolved
    // turn is the cheaper failure.
    const closed = await prisma.turn.updateMany({
      where: { id: openTurn.id, status: "OPEN" },
      data: { status: "RESOLVED", resolvedAt: new Date() },
    });
    if (closed.count === 0) {
      // The winner may still be mid-advance, so this read can come back null.
      // That's reported as-is rather than waited on — see the return contract.
      const winner = await prisma.turn.findFirst({ where: { status: "OPEN" } });
      return {
        advanced: false,
        previousTurn: null,
        newTurn: winner,
        note: null,
        runSideEffects: async () => {},
      };
    }

    ({ lifewebBlood, hungerNotices, disappointedNotices, defaultMovePosts, defaultMoveDms, tagExpiryDms, catatonicDms, catatonicRoleUpdates, catatonicDeaths, catatonicDeathWarnings, dyingDeaths, dyingDeathWarnings, birdNotices, privateDeliveries, publicPosts, zoneMoves, routineNotices, gambitRollNotices } =
      await resolveNeeds(openTurn, config));
  } else {
    // No OPEN turn, which normally means "opening the very first turn". It
    // also means a previous advance claimed its turn and then died before
    // creating the next one — the claim is what removes the OPEN turn, so
    // that crash landed the game here.
    //
    // A RESOLVED turn with no needsResolvedAt is exactly that turn. Finishing
    // it re-runs only the passes it never recorded.
    const unfinished = await prisma.turn.findFirst({
      where: { status: "RESOLVED", needsResolvedAt: null },
      orderBy: { number: "desc" },
    });
    if (unfinished) {
      // The resume needs the same compare-and-swap the normal path does above:
      // without it, the bot's cron and a GM clicking End turn on a crashed
      // turn could both match the same row and both run every outstanding
      // pass, charging Hunger twice and double-decaying the Lifeweb.
      // resolvedPasses is not a lock (markDone is last-write-wins) and
      // needsResolvedAt is the completion stamp written at the END, so the
      // claim needs its own column.
      //
      // The staleness arm matters as much as the claim: a resume that dies
      // holding the lease would otherwise wedge the turn forever.
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
      ({ lifewebBlood, hungerNotices, disappointedNotices, defaultMovePosts, defaultMoveDms, tagExpiryDms, catatonicDms, catatonicRoleUpdates, catatonicDeaths, catatonicDeathWarnings, dyingDeaths, dyingDeathWarnings, birdNotices, privateDeliveries, publicPosts, zoneMoves, routineNotices, gambitRollNotices } =
        await resolveNeeds(unfinished, config));
    }
  }

  const lastTurn = openTurn ?? (await prisma.turn.findFirst({ orderBy: { number: "desc" } }));
  const phase = !lastTurn || lastTurn.phase === "DUSK" ? "DAWN" : "DUSK";
  // Weather rolls every turn, as a Markov step off the previous turn's
  // weather through the table for the phase being entered (see
  // rollWeather() in weather.js) — that's what lets a state like STORM
  // persist for several turns straight regardless of phase, while FOG
  // specifically favors DAWN turns and burns off by DUSK. A GM's manual
  // override (config.nextWeather, set from the Dev Panel) always wins.
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

  // The transcript's chapter divider. Written here rather than in
  // runSideEffects because it records a fact about the turn, not a Discord
  // side effect — a failed announcement post shouldn't leave /archive with no
  // boundary between two days. Stamped with the turn it opens.
  await recordArchiveEvent(prisma, {
    kind: "TURN_START",
    turn: newTurn,
    content: [`Day ${Math.ceil(newTurn.number / 2)} — ${newTurn.phase}`, weather, note]
      .filter(Boolean)
      .join("\n"),
  });

  // The Caving Die — every ALIVE character already standing in the Depths
  // gets one roll for the turn that JUST opened (newTurn, not the one this
  // function is closing). Must roll against the opening turn, not the
  // closing one, or an arrival roll made earlier the same turn claims the row
  // first and the pass rolls nothing (db/lib/cavingPass.js, CAVING.md §2).
  // Placed after the TURN_START archive row so the weather/note reset lands
  // before a roster-wide pass. Still database-only — nothing below this
  // comment talks to Discord until runSideEffects.
  //
  // Own try/catch, and it must never rethrow: a throw escaping this block
  // would abort advanceTurn() after newTurn already exists — no
  // runSideEffects, no turn announcement, for the sake of one missed die.
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

  // Everything below this line talks to Discord and nothing above it does, so
  // the turn is fully committed by the time the caller gets this back. This
  // is the ONLY place in the turn-advance path that makes a network call —
  // every resolveNeeds() pass hands its posts and DMs back rather than
  // sending them. Order matches the narrative: the closing turn's Default
  // Move summaries and DMs, then tag progression, then Hunger, then the
  // announcement opening the next turn, then the Dawn wipe.
  const runSideEffects = async () => {
    // The cutoff every deletion below is bounded by. Taken before the first
    // Discord call, so everything this thunk posts is newer than it — which is
    // what lets the Dawn wipe stay last in the order without eating the
    // summaries posted at the top of it. See db/lib/dawnWipe.js.
    const sideEffectsStartedAt = Date.now();

    // Default Move summary posts first — they narrate the turn that just
    // closed, so they should land before the announcement opening the next.
    for (const post of defaultMovePosts) {
      const sent = await postAsCharacter(post.channelId, post.character, post.message).catch((err) => {
        console.error(`Default Move summary post for ${post.character.id} failed:`, err);
        return null;
      });
      // Only archived once Discord accepted it, and stamped with the CLOSING
      // turn (`previousTurn`) rather than the one just opened — these narrate
      // the turn that ended, which is also why they're posted before the
      // announcement below.
      if (sent) {
        await recordArchiveMessage(prisma, {
          discordMessageId: sent.id,
          content: post.message,
          character: post.character,
          zoneId: post.zoneId,
          zoneName: post.zoneName,
          channelKind: "summary",
          discordChannelId: post.channelId,
          turn: openTurn,
        });
      }
    }

    for (const dm of defaultMoveDms) {
      await sendDm(prisma, dm.discordUserId, dm.content).catch((err) =>
        console.error(`Default Move DM to ${dm.discordUserId} failed:`, err),
      );
    }

    // One DM per player whose condition worsened, before the Hunger DMs
    // below purely so the two arrive in severity order. Sequential and
    // individually caught, like every other loop here — never Promise.all.
    for (const dm of tagExpiryDms) {
      await sendDm(prisma, dm.discordUserId, dm.content).catch((err) =>
        console.error(`Tag progression DM to ${dm.discordUserId} failed:`, err),
      );
    }

    // The Bird's stranded letters. One line, worded identically for a wrong
    // guess and for a dead recipient — see db/lib/birdPass.js for why those
    // two must never be told apart.
    for (const dm of birdNotices) {
      await sendDm(prisma, dm.discordUserId, dm.content).catch((err) =>
        console.error(`Bird failure DM to ${dm.discordUserId} failed:`, err),
      );
    }

    // One DM per player just flagged Catatonic — nothing for one just
    // cleared, since clearing only ever follows the player's own action or
    // speech, which needs no notice.
    for (const dm of catatonicDms) {
      await sendDm(prisma, dm.discordUserId, dm.content).catch((err) =>
        console.error(`Catatonic DM to ${dm.discordUserId} failed:`, err),
      );
    }

    // The personal-role renames the Catatonic pass owes — "<name> • Catatonic"
    // in grey going down, bare name + hash colour coming back (see
    // db/lib/characterRoleAppearance.js). Best-effort like the DMs: a failed
    // rename leaves a stale role name, which the next flag/clear or profile
    // save corrects, so it never blocks the advance.
    for (const update of catatonicRoleUpdates) {
      await patchGuildRole(update.roleId, { name: update.name, color: update.color }).catch((err) =>
        console.error(`Catatonic role rename for ${update.name} failed:`, err),
      );
    }

    // The eve-of-death warnings, before the deaths so the two kinds of news
    // arrive in the order they escalate. Both auto-kill passes warn the close
    // before the axe and both land here, so a player one turn from either end
    // hears it the same way.
    for (const warning of [...catatonicDeathWarnings, ...dyingDeathWarnings]) {
      await sendDm(prisma, warning.discordUserId, warning.content).catch((err) =>
        console.error(`Death warning DM to ${warning.discordUserId} failed:`, err),
      );
    }

    // Every automatic death this close, from both passes, torn down by one
    // loop. Each row carries its own `reason`, which is the only thing that
    // differs between them — a Catatonic timeout and a Dying clock owe Discord
    // exactly the same work, and keeping one loop is what stops the two paths
    // drifting the way the DB halves would have without characterDeath.js.
    const turnDeaths = [...catatonicDeaths, ...dyingDeaths];

    // The teardown — the same steps
    // web/lib/discordGuild.js#killCharacter performs, in the same order
    // (revoke while both ids are still known, then the role delete), plus
    // one membership check up front: the Cursed grant, the nickname clear
    // and the death DM only make sense for a player still in the guild, and
    // for a departed one each would just 403 into the REST breaker's tally.
    // Sequential and individually caught like every loop here — never
    // Promise.all.
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
    // One #leave post covering every death this turn, not one per death — a
    // GM alert should read at a glance, and a single message keeps the
    // rate-limit budget flat however bad the turn was.
    if (turnDeaths.length > 0) {
      await postMessage(
        LEAVE_ANNOUNCE_CHANNEL_ID,
        turnDeaths.map((death) => `${death.name} has died — ${death.reason}`).join("\n"),
      ).catch((err) => console.error("Automatic-death alert to #leave failed:", err));
    }

    // One DM per Caving Die roll, quiet 2-5s included, so every caver sees
    // their face (see db/lib/cavingPass.js). Before the Hunger DMs for the
    // same "worse news first" ordering as tagExpiry above.
    for (const dm of cavingDms) {
      await sendDm(prisma, dm.discordUserId, dm.content).catch((err) =>
        console.error(`Caving DM to ${dm.discordUserId} failed:`, err),
      );
    }

    // One or two DMs per notice, sequential (discordRequest already backs off
    // on 429) and individually caught. No DM for a quiet -1 ⬢, or for a fed
    // character whose streak was already 0 — hungerDm() covers starved,
    // still-recovering (a meal only sheds one tick), and just-recovered.
    // The Dying DM (once, on the turn the streak crosses the cap) is sent
    // second, so a player who's about to see "Dying" on their sheet already
    // knows why.
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

    // The Nobility track (db/lib/hungerPass.js): the eve-of warning and the
    // one DM on the close their Disappointment lands. Nothing on the quiet
    // days in between, and nothing when it clears — the player just ate; they
    // know.
    for (const notice of disappointedNotices) {
      await sendDm(prisma, notice.discordUserId, disappointedDm(notice)).catch((err) =>
        console.error(`Disappointed DM to ${notice.discordUserId} failed:`, err),
      );
    }

    // Staged-relocation Discord side effects, before the private deliveries:
    // a result DM referencing "where you are now" should arrive after the
    // player can actually see the new zone. Sequential, individually caught
    // — see db/lib/zoneMove.js for why nothing here throws.
    const { applyZoneMoveSideEffects } = require("./lib/zoneMove");
    for (const move of zoneMoves) {
      await applyZoneMoveSideEffects(prisma, move).catch((err) =>
        console.error(`Staged zone-move side effects failed for ${move.characterId}:`, err),
      );
    }

    // The staged-arbitration deliveries — everything the GMs composed during
    // the closing turn, released at once (docs/systemdocs/ADJUDICATION.md).
    // Before the announcement because it narrates the turn that just ended.
    // Sequential per recipient like every loop here; each message's row is
    // stamped sentAt only after its sends were attempted, so a crash partway
    // leaves the remainder visibly unsent (the workspace's missed-push
    // banner) rather than falsely delivered. Failures are collected per
    // recipient and land in one staged_push_delivery_failed audit row naming
    // who — the deliverGmMessage convention.
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

    // One canned DM per Routine that passed with nothing written for its
    // player (db/lib/stagedPush.js). After the deliveries above, so a player
    // who did get a real note never sees this one land on top of it.
    for (const notice of routineNotices) {
      await sendDm(prisma, notice.discordUserId, notice.content).catch((err) =>
        console.error(`Passed-Routine DM to ${notice.discordUserId} failed:`, err),
      );
    }

    // The Gambit reveal (db/lib/stagedPush.js): the die was withheld from the
    // player from submit until Moves locked, and this is where they finally
    // learn how it fell.
    for (const notice of gambitRollNotices) {
      await sendDm(prisma, notice.discordUserId, notice.content).catch((err) =>
        console.error(`Gambit roll DM to ${notice.discordUserId} failed:`, err),
      );
    }

    for (const post of publicPosts) {
      const targetChannelId = post.zoneSummaryChannelId;
      if (!targetChannelId) {
        // Composed but nowhere to go — its zone has no summary channel set
        // up yet. Left unsent (no sentAt) so it's still there to release
        // once the channel doctor / zone sync fixes it.
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
        // Batched: a declaration over 2000 characters arrives as several
        // messages in order rather than being rejected outright. A failure
        // partway leaves the earlier chunks posted, and Resend re-posts the
        // whole body — see ADJUDICATION.md §1.
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

    // Inactivity expiry for player threads — independent of the wipe toggle,
    // gated on its own switch inside the pass. After the wipe on purpose, so
    // a thread the wipe just deleted isn't also "expired".
    if (newTurn.phase === "DAWN") {
      await runThreadExpiry(prisma, newTurn).catch((err) =>
        console.error("Thread expiry pass failed:", err),
      );
    }

    // The cheap reconciliation pass, when a GM has opted in — roles and
    // membership only, a handful of requests (db/lib/channelDoctor.js).
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
  // Re-exported so nothing outside db/ has to reach for @prisma/client
  // directly — only this package declares it as a dependency. Needed for
  // Prisma.DbNull, which is the ONLY way to write a SQL NULL into a
  // nullable Json column (a plain null is a validation error).
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
  ...require("./lib/antagonists"),
  ...require("./lib/roleCapacity"),
  ...require("./lib/partySize"),
  ...require("./lib/production"),
  ...require("./lib/depot"),
  ...require("./lib/formatTagRequirement"),
  ...require("./lib/turnFormat"),
  ...require("./lib/turnClock"),
  ...require("./lib/lifeweb"),
  ...require("./lib/gambitModifier"),
  ...require("./lib/moveEffects"),
  ...require("./lib/resourceDelta"),
  ...require("./lib/laborAccess"),
  // Only the pure helper. The revoke functions take prisma as a parameter
  // (the db/lib/dm.js convention) and are deliberately kept off the barrel —
  // require db/lib/accessSweep.js by path.
  zoneChannelIds: require("./lib/accessSweep").zoneChannelIds,
};
