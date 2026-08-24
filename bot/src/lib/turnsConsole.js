const { ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType } = require("discord.js");
const { prisma } = require("@lifeweb/db");

// The anchor message in #turns. Replaces the old #location prompt
// (bot/src/lib/location.js#ensureLocationPrompt, deleted) and carries every
// player entry point as a button, so nothing a player does requires typing in
// a channel — which is the whole point: Discord shows a typing indicator
// under the player's REAL account, and a modal never does.
//
// Deliberately a SEPARATE message from postTurnsAnnouncement's rolling one.
// That announcement deletes and reposts itself every turn; if the buttons
// rode on it, the console would jump above and below the announcement twice
// a day. This one is tracked on GameConfig and reused across restarts.

const TRAVEL_EMOJI = "🗺️";
const MOVE_EMOJI = "⚜️";
const SPEAK_EMOJI = "🔊";

const CONSOLE_TEXT = [
  "» What would you like to do?",
  "-# You can only travel to a directly connected location. Changing Zones takes a turn.",
].join("\n");

function buildConsoleRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("loc:open")
      .setEmoji(TRAVEL_EMOJI)
      .setLabel("Travel")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId("move:open")
      .setEmoji(MOVE_EMOJI)
      .setLabel("Move")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId("say:open")
      .setEmoji(SPEAK_EMOJI)
      .setLabel("Speak")
      .setStyle(ButtonStyle.Secondary),
  );
}

// Same exact-name match db/lib/turnAnnouncement.js#isTurnsChannel uses —
// there is only ever meant to be one, and nothing in the repo creates it.
function isTurnsChannel(channel) {
  return channel.type === ChannelType.GuildText && channel.name?.toLowerCase() === "turns";
}

// Locks #turns down for @everyone (the bot can still post) and makes sure
// exactly one tracked console message exists, reusing it across restarts
// rather than reposting. Called once on ready, same spot as the other
// per-guild catch-up syncs.
async function ensureTurnsConsole(guild) {
  const channel = [...guild.channels.cache.values()].find(isTurnsChannel);
  if (!channel) return;

  await channel.permissionOverwrites.edit(guild.roles.everyone, { SendMessages: false }).catch(() => {});

  const config = await prisma.gameConfig.findUnique({ where: { id: 1 } });
  if (config?.turnsConsoleChannelId === channel.id && config.turnsConsoleMessageId) {
    const existing = await channel.messages.fetch(config.turnsConsoleMessageId).catch(() => null);
    if (existing) return;
  }

  const sent = await channel.send({ content: CONSOLE_TEXT, components: [buildConsoleRow()] });
  await prisma.gameConfig.update({
    where: { id: 1 },
    data: { turnsConsoleChannelId: channel.id, turnsConsoleMessageId: sent.id },
  });
}

module.exports = { ensureTurnsConsole, buildConsoleRow, isTurnsChannel, MOVE_EMOJI };
