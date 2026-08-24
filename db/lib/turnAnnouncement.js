// REST-only turn announcement, called from db/index.js#advanceTurn() — the
// single implementation for both the bot's cron path and the web Dev
// Panel's manual "End Turn" button (previously duplicated: a gateway
// version in bot/src/lib/turnEngine.js, a REST version in
// web/app/(app)/gm/dev/actions.js).
//
// Takes `prisma` as a parameter rather than `require("../index")`, since
// db/index.js is the one importing this module — requiring it back would
// be a circular require resolving to a partial (prisma-less) exports object.
const fs = require("node:fs");
const path = require("node:path");
const { getGuildChannels, postMessage, deleteMessage, postAttachment } = require("./discordRest");
const { buildTurnAnnouncement } = require("../weather");

const CHANNEL_TYPE_TEXT = 0;

// One banner per weather per phase, built by docs/assets/make-weather.py in
// the same 2446x1122 frame as the #info banner. Returns null when the file
// is absent, which is the whole point of resolving it this way: a missing
// asset must cost the guild its banner, never its turn announcement.
const WEATHER_BANNER_DIR = path.join(__dirname, "..", "..", "docs", "assets", "weather");

function weatherBannerPath(turn) {
  if (!turn?.weather || !turn?.phase) return null;
  const file = path.join(
    WEATHER_BANNER_DIR,
    `${turn.weather.toLowerCase()}-${turn.phase.toLowerCase()}.jpg`,
  );
  return fs.existsSync(file) ? file : null;
}

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

  // Discord renders an attachment BELOW its message content, so the banner
  // cannot ride on the announcement and still sit above it — it has to be
  // its own message, posted first. That makes the rolling replace cover two
  // messages rather than one: both are deleted, then both reposted in order.
  const sameChannel = config?.turnsAnnouncementChannelId === turnsChannel.id;
  if (sameChannel && config.turnsBannerMessageId) {
    await deleteMessage(turnsChannel.id, config.turnsBannerMessageId).catch(() => {});
  }
  if (sameChannel && config.turnsAnnouncementMessageId) {
    await deleteMessage(turnsChannel.id, config.turnsAnnouncementMessageId).catch(() => {});
  }

  const bannerFile = weatherBannerPath(newTurn);
  const banner = bannerFile
    ? await postAttachment(turnsChannel.id, bannerFile).catch(() => null)
    : null;
  const sent = await postMessage(turnsChannel.id, text).catch(() => null);

  if (sent || banner) {
    await prisma.gameConfig.update({
      where: { id: 1 },
      data: {
        turnsAnnouncementChannelId: turnsChannel.id,
        turnsAnnouncementMessageId: sent?.id ?? null,
        turnsBannerMessageId: banner?.id ?? null,
      },
    });
  }
}

module.exports = { postTurnsAnnouncement };
