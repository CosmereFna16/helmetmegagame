const { prisma, advanceTurn: advanceTurnInDb } = require("@lifeweb/db");

// Thin wrapper around the shared db.advanceTurn(): adds the audit log entry
// (process-specific — the announcement and Dawn wipe are now handled inside
// advanceTurn() itself, REST-based, so this needs no gateway client).
// Called by the twice-daily cron in ready.js, and safe to call manually as
// a GM force-advance since it's idempotent about which turn is "current".
async function advanceTurn() {
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
        weather: newTurn.weather,
      },
    },
  });

  return newTurn;
}

module.exports = { advanceTurn };
