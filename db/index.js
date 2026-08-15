const { PrismaClient } = require("@prisma/client");
const { rollWeather, buildTurnAnnouncement } = require("./weather");
const { HUNGERLESS_SLUG } = require("./lib/constants");

const globalForPrisma = globalThis;

const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

// Applies per-turn Needs decay (resource consumption, hunger, mood expiry)
// to every ALIVE character for the turn being closed. Shared between the
// bot's cron-triggered advanceTurn() and the GM dashboard's manual
// close-turn override, so both paths behave identically instead of only
// the automated one actually resolving Needs.
async function resolveNeeds(turn, config) {
  const characters = await prisma.character.findMany({ where: { status: "ALIVE" } });
  const consumption = config?.resourceConsumptionPerTurn ?? 1;

  const hungerlessTags = await prisma.characterTag.findMany({
    where: { characterId: { in: characters.map((c) => c.id) }, tag: { slug: HUNGERLESS_SLUG } },
    select: { characterId: true },
  });
  const hungerlessIds = new Set(hungerlessTags.map((ct) => ct.characterId));

  await Promise.all(
    characters.map((character) => {
      const hadEnough = character.resources >= consumption;
      const data = {
        resources: hadEnough ? character.resources - consumption : character.resources,
        isHungry: hadEnough ? false : !hungerlessIds.has(character.id),
      };
      if (character.moodExpiresTurn != null && character.moodExpiresTurn <= turn.number) {
        data.moodState = "NEUTRAL";
        data.moodNote = null;
        data.moodExpiresTurn = null;
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
