const { prisma, advanceTurn: advanceTurnInDb } = require("@lifeweb/db");
const { getSummaryChannels } = require("./channels");

// Thin wrapper around the shared db.advanceTurn(): adds the audit log entry
// and the Discord announcement, both of which need this process's gateway
// client. Called by the twice-daily cron in index.js, and safe to call
// manually as a GM force-advance since it's idempotent about which turn is
// "current".
async function advanceTurn(client) {
  const { previousTurn, newTurn } = await advanceTurnInDb();

  await prisma.auditLog.create({
    data: {
      actorDiscordUserId: "system",
      actionType: "turn_advanced",
      details: {
        previousTurnId: previousTurn?.id ?? null,
        newTurnId: newTurn.id,
        number: newTurn.number,
        phase: newTurn.phase,
      },
    },
  });

  if (client) {
    const day = Math.ceil(newTurn.number / 2);
    const label = newTurn.phase === "DAWN" ? "Dawn breaks" : "Dusk falls";
    const text = `${label} over Evergreen — Day ${day}, Turn ${newTurn.number} (${newTurn.phase}).`;
    for (const guild of client.guilds.cache.values()) {
      for (const channel of getSummaryChannels(guild)) {
        await channel.send(text).catch(() => {});
      }
    }
  }

  return newTurn;
}

module.exports = { advanceTurn };
