const { prisma, advanceTurn: advanceTurnInDb, buildTurnAnnouncement } = require("@lifeweb/db");
const { getTurnsChannel } = require("./channels");

// Turn announcements are a single rolling message in #turns: delete the
// previous one (if the stored id still points at this channel) before
// posting the new one, rather than broadcasting a fresh message every time.
async function postTurnsAnnouncement(client, newTurn, note) {
  const config = await prisma.gameConfig.findUnique({ where: { id: 1 } });
  const text = buildTurnAnnouncement(newTurn, note);

  for (const guild of client.guilds.cache.values()) {
    const channel = getTurnsChannel(guild);
    if (!channel) continue;

    if (config?.turnsAnnouncementChannelId === channel.id && config.turnsAnnouncementMessageId) {
      const prev = await channel.messages.fetch(config.turnsAnnouncementMessageId).catch(() => null);
      if (prev) await prev.delete().catch(() => {});
    }

    const sent = await channel.send(text).catch(() => null);
    if (sent) {
      await prisma.gameConfig.update({
        where: { id: 1 },
        data: { turnsAnnouncementChannelId: channel.id, turnsAnnouncementMessageId: sent.id },
      });
    }
  }
}

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

  if (client) await postTurnsAnnouncement(client, newTurn, note);

  return newTurn;
}

module.exports = { advanceTurn };
