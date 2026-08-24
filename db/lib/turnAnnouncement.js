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
const { TURNS_CONSOLE_ROW, CONSOLE_TEXT } = require("./turnsConsoleRow");

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

// #turns is ONE rolling message: the turn announcement, the weather banner and
// the player console on a single post, deleted and reposted each turn.
//
// It used to be three. The console was deliberately kept separate so it would
// not "jump above and below the announcement twice a day" — but the effect of
// leaving it still while the announcement reposted beneath it was that the
// buttons sank further up the channel every turn until nobody could find
// them, and a wipe of #turns left them gone entirely until the bot next
// restarted (ensureTurnsConsole only ever ran on ready).
//
// One message has no ordering problem to solve. Discord renders content, then
// attachments, then components, which is exactly the wanted layout:
//
//   DAY 4 · DUSK · Rain          <- content
//   [ weather banner ]           <- attachment
//   Travel   Move   Speak        <- components, always last
//
// and the buttons are at the bottom of the channel by construction.
async function postTurnsAnnouncement(prisma, newTurn, note) {
  const guildId = process.env.DISCORD_GUILD_ID;
  const token = process.env.DISCORD_TOKEN;
  if (!guildId || !token) return;

  const channels = await getGuildChannels();
  const turnsChannel = channels.find(isTurnsChannel);
  if (!turnsChannel) return;

  const config = await prisma.gameConfig.findUnique({ where: { id: 1 } });
  const text = [buildTurnAnnouncement(newTurn, note), CONSOLE_TEXT].join("\n");

  const sent = await postTurnsConsole(prisma, turnsChannel.id, text, newTurn, config);
  if (!sent) console.error("Turn announcement: nothing could be posted to #turns");
}

// Posts the rolling message and records its id, replacing whatever was there.
// Shared with the bot's cold-start path (bot/src/lib/turnsConsole.js) so the
// console can never exist in two shapes.
async function postTurnsConsole(prisma, channelId, text, turn, config) {
  if (config?.turnsConsoleChannelId === channelId && config.turnsConsoleMessageId) {
    await deleteMessage(channelId, config.turnsConsoleMessageId).catch(() => {});
  }

  // A missing asset must cost the guild its banner, never its announcement —
  // but it must not do so SILENTLY. Both failure modes are logged and
  // distinguished: absent from disk is a deploy problem, a rejected upload is
  // a permissions or payload problem, and until now they looked identical to
  // each other and to success.
  const bannerFile = weatherBannerPath(turn);
  if (turn && !bannerFile) {
    console.error(
      `Turn announcement: no weather banner for ${turn.weather}/${turn.phase} in ${WEATHER_BANNER_DIR}`,
    );
  }

  let sent = null;
  if (bannerFile) {
    sent = await postAttachment(channelId, bannerFile, text, [TURNS_CONSOLE_ROW]).catch((err) => {
      console.error("Turn announcement: weather banner upload failed:", err);
      return null;
    });
  }
  // No banner, or the upload failed: the announcement and the buttons still go
  // out, just without the picture.
  if (!sent) {
    sent = await postMessage(channelId, text, [TURNS_CONSOLE_ROW]).catch((err) => {
      console.error("Turn announcement: post failed:", err);
      return null;
    });
  }

  if (sent) {
    await prisma.gameConfig.update({
      where: { id: 1 },
      data: { turnsConsoleChannelId: channelId, turnsConsoleMessageId: sent.id },
    });
  }
  return sent;
}

module.exports = { postTurnsAnnouncement, postTurnsConsole, isTurnsChannel, weatherBannerPath };
