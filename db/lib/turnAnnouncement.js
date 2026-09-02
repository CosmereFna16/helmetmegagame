// REST-only turn announcement, called from db/index.js#advanceTurn() — the
// single implementation for both the bot's cron path and the web Dev
// Panel's manual "End Turn" button. Takes `prisma` as a parameter rather
// than `require("../index")`, since db/index.js is the one importing this
// module — requiring it back would be a circular require resolving to a
// partial (prisma-less) exports object.
const fs = require("node:fs");
const path = require("node:path");
const { getGuildChannels, postMessage, deleteMessage, postAttachment } = require("./discordRest");
const { buildTurnAnnouncement } = require("../weather");
const { TURNS_CONSOLE_ROW, CONSOLE_TEXT } = require("./turnsConsoleRow");
const { docsPath } = require("./repoPaths");
const { clearMessagesExcept } = require("./dawnWipe");
const { isTurnsChannel } = require("./turnsChannelAccess");

// One banner per weather per phase, built by docs/assets/make-weather.py in
// the same 2446x1122 frame as the #info banner. Returns null when the file
// is absent, which is the whole point of resolving it this way: a missing
// asset must cost the guild its banner, never its turn announcement.
const WEATHER_BANNER_DIR = docsPath("assets", "weather");

function weatherBannerPath(turn) {
  if (!turn?.weather || !turn?.phase) return null;
  // docsPath returns null when docs/ can't be found at all; repoPaths.js says
  // to treat that as "no banner". Guard it here: path.join(null, ...) throws,
  // and a TypeError here would take the whole turn announcement down with it
  // — the DAY/PHASE header, console text, and Travel/Move/Speak buttons —
  // over a missing image. This mainly bites the WEB container, where
  // Turbopack inlines __dirname as a literal that doesn't exist.
  if (!WEATHER_BANNER_DIR) return null;
  const file = path.join(
    WEATHER_BANNER_DIR,
    `${turn.weather.toLowerCase()}-${turn.phase.toLowerCase()}.jpg`,
  );
  return fs.existsSync(file) ? file : null;
}

// #turns is ONE rolling message: the turn announcement, the weather banner and
// the player console on a single post, deleted and reposted each turn — one
// message has no ordering problem to solve. Discord renders content, then
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
  // The Move-cutoff clause is omitted when auto-advance is off, since there is
  // then no scheduled end to count back from (db/lib/turnClock.js).
  const text = [
    buildTurnAnnouncement(newTurn, note, { autoTurnAdvanceDisabled: config?.autoTurnAdvanceDisabled ?? false }),
    CONSOLE_TEXT,
  ].join("\n");

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
  // a permissions or payload problem.
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
    // Sweep anything else that landed in #turns since the last turn — a
    // stray GM message, an orphaned console from before a config reset.
    // #turns is not in SPECIAL_CHANNELS, so the Dawn wipe never reaches it;
    // this is that channel's only cleanup, and it runs every turn, not just
    // at Dawn. Best-effort: a sweep failure must not cost the turn
    // announcement that already went out.
    await clearMessagesExcept(channelId, sent.id).catch((err) => {
      console.error("Turn announcement: #turns sweep failed:", err);
    });
  }
  return sent;
}

module.exports = { postTurnsAnnouncement, postTurnsConsole, weatherBannerPath };
