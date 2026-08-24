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
const { runTagExpiryPass } = require("./lib/tagExpiryPass");
const { runDawnWipe } = require("./lib/dawnWipe");
const { runHungerPass, HUNGER_DM } = require("./lib/hungerPass");
const { runDefaultMovePass } = require("./lib/defaultMovePass");
// Required by path, not through the barrel: see the note in db/lib/dm.js about
// why there are three same-named sendDm exports with three signatures.
const { sendDm } = require("./lib/dm");
const { recordArchiveMessage, recordArchiveEvent } = require("./lib/archive");
const { postAsCharacter } = require("./lib/discordRest");
const { bumpBlood } = require("./lib/lifeweb");
const { runFullChannelWipe } = require("./lib/fullWipe");
const { syncLocationsFromYaml } = require("./lib/syncLocations");
const { syncTagsFromYaml } = require("./lib/syncTags");
const { deleteCharacterRow } = require("./lib/deleteCharacter");
const { syncRolesFromYaml } = require("./lib/syncRoles");
const { syncDocumentsFromYaml } = require("./lib/syncDocuments");
const { NARROWCAST_SLUGS, buildNarrowcastContext, computeNarrowcastAccess } = require("./lib/narrowcastAccess");
const { syncNarrowcastChannels } = require("./lib/syncNarrowcastChannels");

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
    const next = turn.number + (ct.tag.defaultDurationTurns ?? 1);
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
// close-turn override, so both paths behave identically instead of only the
// automated one actually resolving Needs.
//
// Returns { lifewebBlood, starvedDiscordUserIds, defaultMovePosts,
// defaultMoveDms, tagExpiryDms }. Everything after the first is Discord work
// this function deliberately does NOT perform — the Hunger pass's DM list,
// the Default Move pass's summary posts and DMs, and the tag progression
// pass's DMs. See advanceTurn() below for why.
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

  // A failed pass leaves the turn advancing anyway — that has always been the
  // trade, since a stuck turn is worse than a missed upkeep — but it no longer
  // vanishes into stderr. The row is what makes "everyone ate free on day 12"
  // answerable after the fact, and the pass stays unrecorded so the next
  // advance retries it.
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
      .catch(() => {});
  }

  // Default Moves file FIRST, before anything else here: a Default Move can
  // pay resources in, and the Hunger pass below charges them out, so income
  // has to land before upkeep is taken or a player whose default earns them
  // a meal still goes hungry. It also has to happen while the turn is still
  // the one being closed — it files a real Action against it. Same summary-
  // audit-row shape as the Hunger pass, for the same reason.
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

  // Sweep any turn-scoped tags whose expiresTurn has been reached,
  // independent of everything else here. Two passes, because a stack is ONE
  // CharacterTag row carrying a count rather than N rows (see
  // web/lib/requestEffects.js): an ordinary tag (Mood, Drained, last turn's
  // Hunger) is deleted outright, but a stackable one only sheds a single
  // unit per expiry and rerolls the remainder's timer — otherwise one
  // ration's clock coming due would wipe the character's whole holding.
  //
  // The progression pass goes FIRST, because the deleteMany below is blind:
  // once it has run there is nothing left to read. It grants what each
  // expiring tag turns into (Infected -> Festering, Necrosis -> a limb) and
  // deletes nothing itself, leaving the sweep to remove exactly the rows it
  // just read. Nothing in it kills anyone — the terminal chains stop at the
  // Dying tag and wait for a GM. See db/lib/tagExpiryPass.js.
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
  const { dms: tagExpiryDms = [], ...tagExpirySummary } = progressed ?? {};
  if (progressed) {
    await prisma.auditLog
      .create({
        data: { actorDiscordUserId: "system", actionType: "tag_expiry_resolved", details: tagExpirySummary },
      })
      .catch((err) => console.error("Tag expiry audit log failed:", err));
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
  const { starvedDiscordUserIds = [], ...summary } = hunger ?? {};
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
  // reopen.
  await prisma.turn
    .update({ where: { id: turn.id }, data: { needsResolvedAt: new Date() } })
    .catch((err) => console.error("Failed to stamp needsResolvedAt:", err));

  return { lifewebBlood, starvedDiscordUserIds, defaultMovePosts, defaultMoveDms, tagExpiryDms };
}

async function getConfig() {
  return prisma.gameConfig.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } });
}

// Resolves the currently OPEN turn (applying Needs decay) and opens the next
// one, alternating DAWN/DUSK. Shared by the bot's cron-triggered advance and
// any GM-triggered "End Turn" action so both apply identical turn logic.
//
// This still composes every Discord side effect (the Hunger DMs, the turn
// announcement, and the Dawn message wipe if enabled — all REST-based, see
// db/lib/turnAnnouncement.js and db/lib/dawnWipe.js), but it no longer *runs*
// them: they're returned as a single `runSideEffects()` thunk and the caller
// decides when. That's the fix for the Dev Panel lockup — the wipe walks every
// location, thread and message page sequentially and can take minutes, and
// awaiting it inside a server action froze the whole web app behind a pending
// request. The bot's cron awaits the thunk inline (it's a background process,
// the wait is harmless); the web action runs it via next/server's after(), so
// the response is flushed first. Everything inside is still best-effort:
// individually caught, logged, never thrown.
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
  let starvedDiscordUserIds = [];
  let defaultMovePosts = [];
  let defaultMoveDms = [];
  let tagExpiryDms = [];
  if (openTurn) {
    // Close the turn FIRST, conditioned on it still being OPEN. This is the
    // guard against two advances racing — a GM double-clicking End turn, or
    // clicking it just as the bot's twice-daily cron fires. Postgres
    // serializes the two updateMany's, so exactly one sees count === 1; the
    // loser bails out here instead of resolving Needs a second time and
    // opening a duplicate turn (which needs hand-editing the DB to undo).
    //
    // Closing before resolving (rather than after, as this used to) is what
    // makes the claim atomic. The cost is that a mid-resolve crash leaves the
    // turn RESOLVED with Needs half-applied; the alternative is that a losing
    // racer runs the whole of resolveNeeds() before finding out it lost,
    // double-charging every character's upkeep and double-decaying the
    // Lifeweb. A half-resolved turn is the cheaper failure.
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

    ({ lifewebBlood, starvedDiscordUserIds, defaultMovePosts, defaultMoveDms, tagExpiryDms } =
      await resolveNeeds(openTurn, config));
  } else {
    // No OPEN turn, which normally means "opening the very first turn". It
    // also means something else: a previous advance that claimed its turn and
    // then died before creating the next one. The claim is what removes the
    // OPEN turn, so that crash landed the game here — and here used to do
    // nothing but open a fresh turn, silently skipping that day's hunger,
    // decay and remaining Default Moves with no log of it having happened.
    //
    // A RESOLVED turn with no needsResolvedAt is exactly that turn. Finishing
    // it re-runs only the passes it never recorded.
    const unfinished = await prisma.turn.findFirst({
      where: { status: "RESOLVED", needsResolvedAt: null },
      orderBy: { number: "desc" },
    });
    if (unfinished) {
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
        .catch(() => {});
      ({ lifewebBlood, starvedDiscordUserIds, defaultMovePosts, defaultMoveDms, tagExpiryDms } =
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

  // Everything below this line talks to Discord and nothing above it does, so
  // the turn is fully committed by the time the caller gets this back. This is
  // now the ONLY place in the turn-advance path that makes a network call —
  // all three resolveNeeds() passes hand their posts and DMs back rather than
  // sending them. Order matches the narrative: the closing turn's Default Move
  // summaries and DMs, then the tag progression DMs, then the Hunger DMs, then
  // the announcement opening the next turn, then the Dawn wipe.
  const runSideEffects = async () => {
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
          locationId: post.locationId,
          locationName: post.locationName,
          channelKind: "plain",
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

    // One DM per hungry player, sequential (discordRequest already backs off
    // on 429) and individually caught. No DM for a quiet -1 ⬢.
    for (const discordUserId of starvedDiscordUserIds) {
      await sendDm(prisma, discordUserId, HUNGER_DM).catch((err) =>
        console.error(`Hunger DM to ${discordUserId} failed:`, err),
      );
    }

    await postTurnsAnnouncement(prisma, newTurn, note).catch((err) =>
      console.error("Failed to post turn announcement:", err),
    );

    if (newTurn.phase === "DAWN" && config.messageWipeEnabled) {
      await runDawnWipe(prisma).catch((err) => console.error("Dawn message wipe failed:", err));
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
  syncLocationsFromYaml,
  syncTagsFromYaml,
  deleteCharacterRow,
  syncRolesFromYaml,
  syncDocumentsFromYaml,
  NARROWCAST_SLUGS,
  buildNarrowcastContext,
  computeNarrowcastAccess,
  syncNarrowcastChannels,
  LIFEWEB_SPUTTER_THRESHOLD,
  ...require("./weather"),
  ...require("./lib/constants"),
  ...require("./lib/roleIds"),
  ...require("./lib/roleColor"),
  ...require("./lib/characterName"),
  ...require("./lib/nameCorpus"),
  ...require("./lib/dynasty"),
  ...require("./lib/concealedIdentity"),
  ...require("./lib/antagonists"),
  ...require("./lib/roleCapacity"),
  ...require("./lib/partySize"),
  ...require("./lib/production"),
  ...require("./lib/formatTagRequirement"),
  ...require("./lib/turnFormat"),
  ...require("./lib/mood"),
  ...require("./lib/lifeweb"),
  ...require("./lib/gambitModifier"),
  ...require("./lib/moveEffects"),
  ...require("./lib/resourceDelta"),
  ...require("./lib/laborAccess"),
  ...require("./lib/travelCost"),
  // Only the pure helpers. revokeAllCharacterAccess takes prisma as a
  // parameter (the db/lib/dm.js convention) and is deliberately kept off the
  // barrel — require it by path.
  PERM_VIEW_CHANNEL: require("./lib/locationAccess").PERM_VIEW_CHANNEL,
  OVERWRITE_TYPE_ROLE: require("./lib/locationAccess").OVERWRITE_TYPE_ROLE,
  OVERWRITE_TYPE_MEMBER: require("./lib/locationAccess").OVERWRITE_TYPE_MEMBER,
  locationAccessChannelIds: require("./lib/locationAccess").locationAccessChannelIds,
};
