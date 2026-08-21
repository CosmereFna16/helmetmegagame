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
const { runDawnWipe } = require("./lib/dawnWipe");
const { runHungerPass } = require("./lib/hungerPass");
const { runDefaultMovePass } = require("./lib/defaultMovePass");
const { runFullChannelWipe } = require("./lib/fullWipe");
const { syncLocationsFromYaml } = require("./lib/syncLocations");
const { syncTagsFromYaml } = require("./lib/syncTags");
const { syncRolesFromYaml } = require("./lib/syncRoles");
const { NARROWCAST_SLUGS, buildNarrowcastContext, computeNarrowcastAccess } = require("./lib/narrowcastAccess");
const { syncNarrowcastChannels } = require("./lib/syncNarrowcastChannels");

const globalForPrisma = globalThis;

const prisma =
  globalForPrisma.prisma ?? new PrismaClient(databaseUrl ? { datasourceUrl: databaseUrl } : undefined);

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

// Below this, the turn announcement gets a vague public omen line (see
// advanceTurn() below) without ever naming the actual number — the Blood
// value itself stays visible only to Mortus-tagged characters and GMs
// (web/app/(app)/lifeweb/page.js).
const LIFEWEB_SPUTTER_THRESHOLD = 20;

// Applies per-turn Needs decay to the turn being closed. Shared between the
// bot's cron-triggered advanceTurn() and the GM dashboard's manual
// close-turn override, so both paths behave identically instead of only the
// automated one actually resolving Needs.
async function resolveNeeds(turn, config) {
  // Default Moves file FIRST, before anything else here: a Default Move can
  // pay resources in, and the Hunger pass below charges them out, so income
  // has to land before upkeep is taken or a player whose default earns them
  // a meal still goes hungry. It also has to happen while the turn is still
  // the one being closed — it files a real Action against it. Same summary-
  // audit-row shape as the Hunger pass, for the same reason.
  const defaults = await runDefaultMovePass(prisma, turn).catch((err) => {
    console.error("Default Move pass failed:", err);
    return null;
  });
  if (defaults?.filed) {
    await prisma.auditLog
      .create({
        data: { actorDiscordUserId: "system", actionType: "default_moves_resolved", details: defaults },
      })
      .catch((err) => console.error("Default Move audit log failed:", err));
  }

  // Sweep any turn-scoped tags (Mood, Drained, last turn's Hunger) whose
  // expiresTurn has been reached — a single bulk delete, independent of
  // everything else here.
  await prisma.characterTag.deleteMany({ where: { expiresTurn: { lte: turn.number } } });

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
  const hunger = await runHungerPass(prisma, turn).catch((err) => {
    console.error("Hunger pass failed:", err);
    return null;
  });
  if (hunger) {
    await prisma.auditLog
      .create({
        data: { actorDiscordUserId: "system", actionType: "hunger_resolved", details: hunger },
      })
      .catch((err) => console.error("Hunger audit log failed:", err));
  }

  // The Lifeweb bleeds out a fixed amount every turn regardless of what fed
  // it last — see donateBlood()/feedLifewebPerson() in
  // web/app/(app)/lifeweb/actions.js for the ways it's topped back up.
  const newBlood = Math.max(0, (config?.lifewebBlood ?? 100) - (config?.lifewebDecayPerTurn ?? 10));
  await prisma.gameConfig.update({ where: { id: 1 }, data: { lifewebBlood: newBlood } });
  return newBlood;
}

async function getConfig() {
  return prisma.gameConfig.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } });
}

// Resolves the currently OPEN turn (applying Needs decay) and opens the next
// one, alternating DAWN/DUSK. Shared by the bot's cron-triggered advance and
// any GM-triggered "End Turn" action so both apply identical turn logic —
// this now also owns every Discord side effect (turn announcement, and the
// Dawn message wipe if enabled), all REST-based (db/lib/turnAnnouncement.js,
// db/lib/dawnWipe.js), so callers don't need to duplicate any of it
// regardless of whether they have a gateway client or not. Both are
// best-effort: a Discord-side failure is logged, never thrown, so it can
// never block or roll back the turn advance itself.
async function advanceTurn() {
  const config = await getConfig();
  const openTurn = await prisma.turn.findFirst({ where: { status: "OPEN" } });

  let lifewebBlood = config.lifewebBlood;
  if (openTurn) {
    lifewebBlood = await resolveNeeds(openTurn, config);
    await prisma.turn.update({
      where: { id: openTurn.id },
      data: { status: "RESOLVED", resolvedAt: new Date() },
    });
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

  await postTurnsAnnouncement(prisma, newTurn, note).catch((err) =>
    console.error("Failed to post turn announcement:", err),
  );

  if (newTurn.phase === "DAWN" && config.messageWipeEnabled) {
    await runDawnWipe(prisma).catch((err) => console.error("Dawn message wipe failed:", err));
  }

  return { previousTurn: openTurn, newTurn, note };
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
  syncRolesFromYaml,
  NARROWCAST_SLUGS,
  buildNarrowcastContext,
  computeNarrowcastAccess,
  syncNarrowcastChannels,
  LIFEWEB_SPUTTER_THRESHOLD,
  ...require("./weather"),
  ...require("./lib/constants"),
  ...require("./lib/roleColor"),
  ...require("./lib/roleCapacity"),
  ...require("./lib/production"),
  ...require("./lib/formatTagRequirement"),
  ...require("./lib/mood"),
  ...require("./lib/lifeweb"),
  ...require("./lib/gambitModifier"),
  ...require("./lib/moveEffects"),
  ...require("./lib/resourceDelta"),
};
