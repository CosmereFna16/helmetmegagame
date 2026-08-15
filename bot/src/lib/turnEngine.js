const { prisma, advanceTurn: advanceTurnInDb, buildTurnAnnouncement } = require("@lifeweb/db");
const { getSummaryChannels } = require("./channels");

// Thin wrapper around the shared db.advanceTurn(): adds the audit log entry
// and the Discord announcement, both of which need this process's gateway
// client. Called by the twice-daily cron in index.js, and safe to call
// manually as a GM force-advance since it's idempotent about which turn is
// "current".
async function advanceTurn(client) {
  const { previousTurn, newTurn, note } = await advanceTurnInDb();

  await prisma.auditLog.create({
    data: {
      actorDiscordUserId: "system",
      actionType: "turn_advanced",
      details: {
        previousTurnId: previousTurn?.id ?? null,
        newTurnId: newTurn.id,
        number: newTurn.number,
        phase: newTurn.phase,
        weather: newTurn.weather,
      },
    },
  });

  if (client) {
    const text = buildTurnAnnouncement(newTurn, note);
    for (const guild of client.guilds.cache.values()) {
      for (const channel of getSummaryChannels(guild)) {
        await channel.send(text).catch(() => {});
      }
    }
  }

  return newTurn;
}

module.exports = { advanceTurn };
