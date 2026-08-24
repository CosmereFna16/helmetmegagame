const { ChannelType } = require("discord.js");
const { prisma } = require("@lifeweb/db");
const { postTurnsConsole } = require("@lifeweb/db/lib/turnAnnouncement");
const { CONSOLE_TEXT } = require("@lifeweb/db/lib/turnsConsoleRow");
const { buildTurnAnnouncement } = require("@lifeweb/db/weather");

// #turns is one rolling message — announcement, weather banner and the
// Travel/Move/Speak buttons on a single post that db/lib/turnAnnouncement.js
// replaces every turn. See the comment there for why it stopped being three.
//
// This file is now only the COLD START: at ready, make sure that message
// exists at all. It normally does, and this does nothing. It matters in two
// cases the turn cycle cannot cover on its own — a fresh guild that has never
// advanced a turn, and a #turns that was wiped (Restart Game deletes every
// message in it, db/lib/fullWipe.js) where players would otherwise face an
// empty channel until the next dawn or dusk.

// Same exact-name match db/lib/turnAnnouncement.js#isTurnsChannel uses —
// there is only ever meant to be one, and nothing in the repo creates it.
function isTurnsChannel(channel) {
  return channel.type === ChannelType.GuildText && channel.name?.toLowerCase() === "turns";
}

// Locks #turns down for @everyone (the bot can still post) and makes sure the
// console message exists, reusing it across restarts rather than reposting.
async function ensureTurnsConsole(guild) {
  const channel = [...guild.channels.cache.values()].find(isTurnsChannel);
  if (!channel) {
    // Silent until now, which made a renamed or missing #turns look identical
    // to a working one — both the console and the turn announcement find the
    // channel by exact name, so they fail together and said nothing.
    console.error('Turns console: no text channel named "turns" in', guild.name);
    return;
  }

  await channel.permissionOverwrites.edit(guild.roles.everyone, { SendMessages: false }).catch(() => {});

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
