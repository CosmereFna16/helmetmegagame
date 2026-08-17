// REST-only turn announcement, called from db/index.js#advanceTurn() — the
// single implementation for both the bot's cron path and the web Dev
// Panel's manual "End Turn" button (previously duplicated: a gateway
// version in bot/src/lib/turnEngine.js, a REST version in
// web/app/(app)/gm/dev/actions.js).
//
// Takes `prisma` as a parameter rather than `require("../index")`, since
// db/index.js is the one importing this module — requiring it back would
// be a circular require resolving to a partial (prisma-less) exports object.
const { getGuildChannels, postMessage, deleteMessage } = require("./discordRest");
const { buildTurnAnnouncement } = require("../weather");

const CHANNEL_TYPE_TEXT = 0;

function isTurnsChannel(channel) {
  return channel.type === CHANNEL_TYPE_TEXT && channel.name?.toLowerCase() === "turns";
}

// Turn announcements are a single rolling message in #turns: delete the
// previous one (if the stored id still points at this channel) before
// posting the new one, rather than broadcasting a fresh message every time.
async function postTurnsAnnouncement(prisma, newTurn, note) {
  const guildId = process.env.DISCORD_GUILD_ID;
  const token = process.env.DISCORD_TOKEN;
  if (!guildId || !token) return;

  const channels = await getGuildChannels();
  const turnsChannel = channels.find(isTurnsChannel);
  if (!turnsChannel) return;

  const config = await prisma.gameConfig.findUnique({ where: { id: 1 } });
  const text = buildTurnAnnouncement(newTurn, note);

  if (config?.turnsAnnouncementChannelId === turnsChannel.id && config.turnsAnnouncementMessageId) {
    await deleteMessage(turnsChannel.id, config.turnsAnnouncementMessageId).catch(() => {});
  }
  const sent = await postMessage(turnsChannel.id, text).catch(() => null);
  if (sent) {
    await prisma.gameConfig.update({
      where: { id: 1 },
      data: { turnsAnnouncementChannelId: turnsChannel.id, turnsAnnouncementMessageId: sent.id },
    });
  }
}

module.exports = { postTurnsAnnouncement };
