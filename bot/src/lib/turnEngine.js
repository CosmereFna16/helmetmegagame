const { prisma, resolveNeeds } = require("@lifeweb/db");

async function getConfig() {
  return prisma.gameConfig.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } });
}

// Resolves the currently OPEN turn (applying Needs decay) and opens the next
// one. Called by the twice-daily cron in index.js, and safe to call manually
// as a GM force-advance since it's idempotent about which turn is "current".
async function advanceTurn(client) {
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

  const newTurn = await prisma.turn.create({
    data: { number: (lastTurn?.number ?? 0) + 1, phase, gameDate: new Date(), status: "OPEN" },
  });

  await prisma.auditLog.create({
    data: {
      actorDiscordUserId: "system",
      actionType: "turn_advanced",
      details: {
        previousTurnId: openTurn?.id ?? null,
        newTurnId: newTurn.id,
        number: newTurn.number,
        phase: newTurn.phase,
      },
    },
  });

  if (config.summaryChannelId && client) {
    const channel = await client.channels.fetch(config.summaryChannelId).catch(() => null);
    if (channel?.isTextBased()) {
      const day = Math.ceil(newTurn.number / 2);
      const label = newTurn.phase === "DAWN" ? "Dawn breaks" : "Dusk falls";
      await channel
        .send(`${label} over Evergreen — Day ${day}, Turn ${newTurn.number} (${newTurn.phase}).`)
        .catch(() => {});
    }
  }

  return newTurn;
}

module.exports = { advanceTurn };
