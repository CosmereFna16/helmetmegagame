const { SlashCommandBuilder } = require("discord.js");
const { LABOR_FIELDS, FIELD_INFO, LABOR_RULES } = require("@lifeweb/db");

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
  // Private-thread guest list. A ROLE option rather than a user option on
  // purpose: the picker then names characters, never Discord accounts, so
  // inviting someone can't reveal who plays them — the same reason the
  // personal role is the mentionable name token in the first place. The
  // handler resolves the role back to a Character and ignores anything that
  // isn't one (GM, spectator, player roles).
  new SlashCommandBuilder()
    .setName("add")
    .setDescription("Bring a character into this private thread.")
    .addRoleOption((opt) => opt.setName("character").setDescription("Whose role to add").setRequired(true))
    .setDMPermission(false),
  new SlashCommandBuilder()
    .setName("remove")
    .setDescription("Remove a character from this private thread.")
    .addRoleOption((opt) => opt.setName("character").setDescription("Whose role to remove").setRequired(true))
    .setDMPermission(false),
  // Marks the current thread to survive the Dawn wipe — the ⏰ forum tag on a
  // forum post, a ⏰ name prefix on a private thread (text channels can't carry
  // forum tags). Toggles, so the same command unmarks. No options: it always
  // acts on the thread it was run in.
  new SlashCommandBuilder()
    .setName("persistent")
    .setDescription("Toggle whether this thread survives the Dawn wipe.")
    .setDMPermission(false),
  // One command per field rather than the old `/labor field:hunt`, so the
  // slash command and the "/hunt" text shorthand a Move or a Default Move
  // accepts are spelled identically. Built from LABOR_FIELDS so the two
  // can't drift apart. Deregistering /labor needs no cleanup — registerCommands
  // uses guild.commands.set(), a full replace.
  ...LABOR_FIELDS.map((field) =>
    new SlashCommandBuilder()
      .setName(field)
      // Discord caps a command description at 100 characters, and the
      // longest of these ("Fishing ... only in the Fortress or Town") lands
      // near enough that the builder throws rather than truncating — keep any
      // rewording short.
      .setDescription(
        `${FIELD_INFO[field].noun} for Resources, scaled to your tags — ${LABOR_RULES[field].where}.`,
      )
      .setDMPermission(false),
  ),
].map((builder) => builder.toJSON());

async function registerCommands(guild) {
  await guild.commands.set(commandDefinitions);
}

module.exports = { commandDefinitions, registerCommands };
