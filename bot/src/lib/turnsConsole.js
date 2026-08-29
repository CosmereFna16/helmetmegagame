const { prisma } = require("@lifeweb/db");
const { postTurnsConsole } = require("@lifeweb/db/lib/turnAnnouncement");
const {
  isTurnsChannel,
  syncTurnsChannelAccess,
} = require("@lifeweb/db/lib/turnsChannelAccess");
const { CONSOLE_TEXT } = require("@lifeweb/db/lib/turnsConsoleRow");
const { buildTurnAnnouncement } = require("@lifeweb/db/weather");

// #turns is one rolling message — announcement, weather banner and the
// Travel/Move/Speak buttons on a single post that db/lib/turnAnnouncement.js
// replaces every turn. See the comment there for why it stopped being three.
//
// This file is now only the COLD START: at ready, make sure that message
// exists at all. It normally does, and this does nothing. It matters for a
// fresh guild that has never advanced a turn, and as the backstop for a
// repost that failed.
//
// Restart Game used to be the case that made this file load-bearing: it
// deletes every message in #turns (db/lib/fullWipe.js) and opens Turn 1
// without advancing a turn, so players faced an empty channel until the next
// dawn or dusk. It reposts the console itself now — see finishGameWipe in
// web/app/(app)/gm/dev/actions.js.

// Re-asserts who can see and speak in #turns (db/lib/turnsChannelAccess.js:
// @everyone denied, every zone role allowed the view, so the channel appears
// the moment a player has a character) and makes sure the console message
// exists, reusing it across restarts rather than reposting.
async function ensureTurnsConsole(guild) {
  const channel = [...guild.channels.cache.values()].find(isTurnsChannel);
  if (!channel) {
    // Silent until now, which made a renamed or missing #turns look identical
    // to a working one — both the console and the turn announcement find the
    // channel by exact name, so they fail together and said nothing.
    console.error('Turns console: no text channel named "turns" in', guild.name);
    return;
  }

  await syncTurnsChannelAccess(prisma, { channelId: channel.id }).catch((err) => {
    console.error("Turns console: access sync failed:", err);
  });

  const config = await prisma.gameConfig.findUnique({ where: { id: 1 } });
  if (config?.turnsConsoleChannelId === channel.id && config.turnsConsoleMessageId) {
    const existing = await channel.messages.fetch(config.turnsConsoleMessageId).catch(() => null);
    if (existing) return;
  }

  // Nothing tracked, or the tracked message is gone. Repost it against the
  // open turn so a cold start still shows the current weather; with no turn
  // open the announcement line is simply omitted.
  const openTurn = await prisma.turn.findFirst({ where: { status: "OPEN" }, orderBy: { number: "desc" } });
  const text = [openTurn ? buildTurnAnnouncement(openTurn, null) : null, CONSOLE_TEXT]
    .filter(Boolean)
    .join("\n");

  await postTurnsConsole(prisma, channel.id, text, openTurn, config);
}

module.exports = { ensureTurnsConsole, isTurnsChannel };
