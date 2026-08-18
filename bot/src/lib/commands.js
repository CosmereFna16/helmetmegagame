const { SlashCommandBuilder } = require("discord.js");

// Slash command definitions, registered per-guild on ready (see
// registerCommands below) so they're available instantly rather than
// waiting on global command propagation. Handlers live in
// bot/src/events/interactionCreate.js.
const commandDefinitions = [
  new SlashCommandBuilder()
    .setName("gm")
    .setDescription("Speak in this channel as the bot itself (GM only).")
    .addStringOption((opt) => opt.setName("message").setDescription("What to say").setRequired(true))
    .addAttachmentOption((opt) => opt.setName("attachment").setDescription("Optional image/file to attach"))
    .setDMPermission(false),
  new SlashCommandBuilder()
    .setName("message")
    .setDescription("DM a player as the bot itself (GM only).")
    .addUserOption((opt) => opt.setName("recipient").setDescription("Who to message").setRequired(true))
    .addStringOption((opt) => opt.setName("message").setDescription("What to say").setRequired(true))
    .setDMPermission(false),
].map((builder) => builder.toJSON());

async function registerCommands(guild) {
  await guild.commands.set(commandDefinitions);
}

module.exports = { commandDefinitions, registerCommands };
