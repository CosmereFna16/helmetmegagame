const { PrismaClient } = require("@prisma/client");
const { rollWeather, buildTurnAnnouncement } = require("./weather");
const { postTurnsAnnouncement } = require("./lib/turnAnnouncement");
const { runDawnWipe } = require("./lib/dawnWipe");
const { runFullChannelWipe } = require("./lib/fullWipe");
const { syncLocationsFromYaml } = require("./lib/syncLocations");

const globalForPrisma = globalThis;

const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

// Below this, the turn announcement gets a vague public omen line (see
// advanceTurn() below) without ever naming the actual number — the Blood
// value itself stays visible only to Mortus-tagged characters and GMs
// (web/app/(app)/lifeweb/page.js).
const LIFEWEB_SPUTTER_THRESHOLD = 20;

// Applies per-turn Needs decay (mood expiry) to every ALIVE character for
// the turn being closed. Shared between the bot's cron-triggered
// advanceTurn() and the GM dashboard's manual close-turn override, so both
// paths behave identically instead of only the automated one actually
// resolving Needs.
async function resolveNeeds(turn, config) {
  const characters = await prisma.character.findMany({ where: { status: "ALIVE" } });

  await Promise.all(
    characters.map((character) => {
      if (character.moodExpiresTurn == null || character.moodExpiresTurn > turn.number) return null;
      return prisma.character.update({
        where: { id: character.id },
        data: { moodState: "NEUTRAL", moodNote: null, moodExpiresTurn: null },
      });
    }),
  );

  // Sweep any turn-scoped tags (Drained, ...) whose expiresTurn has been
  // reached — a single bulk delete rather than a per-character check, since
  // it's independent of everything computed above.
  await prisma.characterTag.deleteMany({ where: { expiresTurn: { lte: turn.number } } });

  // The Lifeweb bleeds out a fixed amount every turn regardless of what fed
  // it last — see feedLifewebBlood()/feedLifewebCorpse() (web/app/(app)/character/actions.js,
  // web/app/(app)/lifeweb/actions.js) for the two ways it's topped back up.
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
  resolveNeeds,
  advanceTurn,
  runFullChannelWipe,
  syncLocationsFromYaml,
  LIFEWEB_SPUTTER_THRESHOLD,
  ...require("./weather"),
  ...require("./lib/constants"),
  ...require("./lib/roleColor"),
  ...require("./lib/production"),
};
