const { PrismaClient } = require("@prisma/client");

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

  await Promise.all(
    characters.map((character) => {
      const hadEnough = character.resources >= consumption;
      const data = {
        resources: hadEnough ? character.resources - consumption : character.resources,
        isHungry: !hadEnough,
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

module.exports = { prisma, resolveNeeds };
