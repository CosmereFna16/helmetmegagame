const { PrismaClient } = require("@prisma/client");
const { rollWeather, buildTurnAnnouncement } = require("./weather");
const { HUNGERLESS_SLUG, NOBILITY_SLUG } = require("./lib/constants");

const globalForPrisma = globalThis;

const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

// A Nobility character who goes this many turns without a Fine (or Lavish)
// meal sours to Unhappy until they eat again — see resolveNeeds() below and
// ateMeal() in web/app/(app)/character/actions.js.
const NOBILITY_UNHAPPY_THRESHOLD_TURNS = 3;

// Applies per-turn Needs decay (resource consumption, hunger, mood expiry)
// to every ALIVE character for the turn being closed. Shared between the
// bot's cron-triggered advanceTurn() and the GM dashboard's manual
// close-turn override, so both paths behave identically instead of only
// the automated one actually resolving Needs.
async function resolveNeeds(turn, config) {
  const characters = await prisma.character.findMany({ where: { status: "ALIVE" } });
  const consumption = config?.resourceConsumptionPerTurn ?? 1;

  const [hungerlessTags, nobilityTags] = await Promise.all([
    prisma.characterTag.findMany({
      where: { characterId: { in: characters.map((c) => c.id) }, tag: { slug: HUNGERLESS_SLUG } },
      select: { characterId: true },
    }),
    prisma.characterTag.findMany({
      where: { characterId: { in: characters.map((c) => c.id) }, tag: { slug: NOBILITY_SLUG } },
      select: { characterId: true },
    }),
  ]);
  const hungerlessIds = new Set(hungerlessTags.map((ct) => ct.characterId));
  const nobilityIds = new Set(nobilityTags.map((ct) => ct.characterId));

  await Promise.all(
    characters.map((character) => {
      const data = {};

      // A meal eaten this turn (see ateMeal()) exempts this turn's automatic
      // consumption — one-shot, cleared once spent.
      if (character.skipNextMealConsumption) {
        data.isHungry = false;
        data.skipNextMealConsumption = false;
      } else {
        const hadEnough = character.resources >= consumption;
        data.resources = hadEnough ? character.resources - consumption : character.resources;
        data.isHungry = hadEnough ? false : !hungerlessIds.has(character.id);
      }

      // Nobility characters have a mood "baseline" driven by how long it's
      // been since their last Fine/Lavish meal: Unhappy once that gap hits
      // the threshold, Neutral otherwise. A temporary Happy (from a meal or
      // a manual mood set) overlays this baseline and, once its duration
      // expires below, reveals whatever the baseline has become by then.
      let baseline = null;
      if (nobilityIds.has(character.id) && character.lastFineMealTurn != null) {
        const turnsSince = turn.number - character.lastFineMealTurn;
        baseline = turnsSince >= NOBILITY_UNHAPPY_THRESHOLD_TURNS ? "UNHAPPY" : "NEUTRAL";
      }

      if (character.moodExpiresTurn != null && character.moodExpiresTurn <= turn.number) {
        data.moodState = baseline ?? "NEUTRAL";
        data.moodNote = null;
        data.moodExpiresTurn = null;
      } else if (character.moodExpiresTurn == null && baseline != null && character.moodState !== baseline) {
        data.moodState = baseline;
        data.moodNote = null;
      }

      return prisma.character.update({ where: { id: character.id }, data });
    }),
  );
}

async function getConfig() {
  return prisma.gameConfig.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } });
}

// Resolves the currently OPEN turn (applying Needs decay) and opens the next
// one, alternating DAWN/DUSK. Shared by the bot's cron-triggered advance and
// any GM-triggered "End Turn" action so both apply identical turn logic —
// callers are responsible for anything Discord-specific (announcements),
// since the transport for that differs between the bot's gateway client and
// the web app's REST calls.
async function advanceTurn() {
  const config = await getConfig();
  const openTurn = await prisma.turn.findFirst({ where: { status: "OPEN" } });

  if (openTurn) {
    await resolveNeeds(openTurn, config);
    await prisma.turn.update({
      where: { id: openTurn.id },
      data: { status: "RESOLVED", resolvedAt: new Date() },
    });
  }

  const lastTurn = openTurn ?? (await prisma.turn.findFirst({ orderBy: { number: "desc" } }));
  const phase = !lastTurn || lastTurn.phase === "DUSK" ? "DAWN" : "DUSK";
  const weather = config.nextWeather ?? rollWeather();
  const note = config.nextTurnNote;

  const newTurn = await prisma.turn.create({
    data: { number: (lastTurn?.number ?? 0) + 1, phase, weather, gameDate: new Date(), status: "OPEN" },
  });

  await prisma.gameConfig.update({
    where: { id: 1 },
    data: { nextWeather: null, nextTurnNote: null },
  });

  return { previousTurn: openTurn, newTurn, note };
}

module.exports = { prisma, resolveNeeds, advanceTurn, ...require("./weather"), ...require("./lib/constants") };
