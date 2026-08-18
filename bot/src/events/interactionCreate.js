const { MessageFlags } = require("discord.js");
const { prisma } = require("@lifeweb/db");
const {
  buildZoneSelectRow,
  buildLocationSelectRow,
  buildConfirmRow,
  performMove,
} = require("../lib/location");
const { performLabor } = require("../lib/labor");
const { sendDm } = require("../lib/dm");

function isGmMember(interaction) {
  const gmRoleId = process.env.DISCORD_GM_ROLE_ID;
  if (!gmRoleId) return false;
  return interaction.member?.roles.cache.has(gmRoleId) ?? false;
}

// /gm: post to the current channel as the bot itself, not the invoker's
// character — the slash-command replacement for the old ":gm" message
// prefix (deleted the invoker's message and reposted it; a slash command
// has no message of its own to delete, so it just sends directly).
async function handleGmCommand(interaction) {
  if (!isGmMember(interaction)) {
    await interaction.reply({ content: "» *GMs only.*", flags: MessageFlags.Ephemeral });
    return;
  }

  const content = interaction.options.getString("message", true);
  const attachment = interaction.options.getAttachment("attachment");

  await interaction.channel.send({ content, files: attachment ? [attachment.url] : [] });
  await interaction.reply({ content: "» *Sent.*", flags: MessageFlags.Ephemeral });
}

// /message: DM a chosen server member as the bot itself. Reuses
// bot/src/lib/dm.js#sendDm so it's logged to DirectMessage like every
// other bot-sent DM, and carries the "»" prefix inline since this is a
// bot-composed DM (see the "Bot message style" note in CLAUDE.md).
async function handleMessageCommand(interaction) {
  if (!isGmMember(interaction)) {
    await interaction.reply({ content: "» *GMs only.*", flags: MessageFlags.Ephemeral });
    return;
  }

  const recipient = interaction.options.getUser("recipient", true);
  const content = interaction.options.getString("message", true);

  try {
    await sendDm(recipient, `» ${content}`);
    await interaction.reply({ content: `» *Sent to ${recipient}.*`, flags: MessageFlags.Ephemeral });
  } catch (err) {
    console.error("Failed to send /message DM:", err);
    await interaction.reply({ content: "» *Failed to deliver — they may have DMs closed.*", flags: MessageFlags.Ephemeral });
  }
}

// /labor: any player with a living, un-acted character can use this — no GM
// gate. See bot/src/lib/labor.js#performLabor for the tag-tier lookup and
// auto-resolved Action creation.
async function handleLaborCommand(interaction) {
  const character = await findAliveCharacter(interaction.user.id);
  if (!character) {
    await interaction.reply({ content: "» *You don't have a living character.*", flags: MessageFlags.Ephemeral });
    return;
  }

  const field = interaction.options.getString("field", true);
  const result = await performLabor(character, field);
  if (!result.ok) {
    await interaction.reply({ content: `» *${result.reason}*`, flags: MessageFlags.Ephemeral });
    return;
  }

  const lines = [`» ${character.name} ${field === "hunt" ? "hunted" : field === "herd" ? "herded" : field === "fish" ? "fished" : "farmed"}.`];
  if (result.resourceDiceExpression) {
    lines.push(`**Resource roll (${result.resourceDiceExpression}):** rolled ${result.diceSum} → +${result.resourceDelta}`);
  } else {
    lines.push(`**Resource change:** +${result.resourceDelta}`);
  }
  lines.push("» *Move confirmed — waiting on GM review.*");

  await interaction.reply({ content: lines.join("\n"), flags: MessageFlags.Ephemeral });
}

// The bot's first use of buttons/select-menus/interactionCreate (everything
// else is reaction+DM driven) — see the "Location picker" section of
// CLAUDE.md. All custom IDs are namespaced "loc:" for the zone/location
// travel flow triggered from the Move button in the "location" channel
// (bot/src/lib/location.js#ensureLocationPrompt).
async function findAliveCharacter(discordUserId) {
  return prisma.character.findFirst({ where: { discordUserId, status: "ALIVE" } });
}

async function handleOpen(interaction) {
  const character = await findAliveCharacter(interaction.user.id);
  if (!character) {
    await interaction.reply({ content: "» *You don't have a living character.*", flags: MessageFlags.Ephemeral });
    return;
  }

  const zones = await prisma.zone.findMany({ orderBy: { name: "asc" } });
  if (zones.length === 0) {
    await interaction.reply({ content: "» *No zones exist yet.*", flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.reply({
    content: "Where would you like to move? Choose a zone.",
    components: [buildZoneSelectRow(zones)],
    flags: MessageFlags.Ephemeral,
  });
}

async function handleZoneSelect(interaction) {
  const zoneId = interaction.values[0];
  const locations = await prisma.location.findMany({ where: { zoneId }, orderBy: { name: "asc" } });
  if (locations.length === 0) {
    await interaction.update({ content: "» *That zone has no locations yet.*", components: [] });
    return;
  }

  await interaction.update({
    content: "Choose a location.",
    components: [buildLocationSelectRow(zoneId, locations)],
  });
}

async function handlePlaceSelect(interaction) {
  const locationId = interaction.values[0];
  const location = await prisma.location.findUnique({ where: { id: locationId } });
  if (!location) {
    await interaction.update({ content: "» *That location no longer exists.*", components: [] });
    return;
  }

  await interaction.update({
    content: `Move to **${location.name}**?`,
    components: [buildConfirmRow(locationId)],
  });
}

async function handleConfirm(interaction, locationId) {
  await interaction.deferUpdate();

  const character = await findAliveCharacter(interaction.user.id);
  if (!character) {
    await interaction.editReply({ content: "» *You don't have a living character.*", components: [] });
    return;
  }

  const location = await prisma.location.findUnique({ where: { id: locationId } });
  if (!location) {
    await interaction.editReply({ content: "» *That location no longer exists.*", components: [] });
    return;
  }

  const result = await performMove(interaction.guild, character, location);
  if (!result.ok) {
    await interaction.editReply({ content: `» *${result.reason}*`, components: [] });
    return;
  }

  const suffix = result.free ? "" : " Your turn is spent.";
  await interaction.editReply({ content: `» Moved to **${location.name}**.${suffix}`, components: [] });
}

async function handleCancel(interaction) {
  await interaction.update({ content: "» *Cancelled.*", components: [] });
}

module.exports = {
  name: "interactionCreate",
  async execute(interaction) {
    try {
      if (interaction.isChatInputCommand()) {
        if (interaction.commandName === "gm") return void (await handleGmCommand(interaction));
        if (interaction.commandName === "message") return void (await handleMessageCommand(interaction));
        if (interaction.commandName === "labor") return void (await handleLaborCommand(interaction));
      } else if (interaction.isButton()) {
        if (interaction.customId === "loc:open") return void (await handleOpen(interaction));
        if (interaction.customId === "loc:cancel") return void (await handleCancel(interaction));
        if (interaction.customId.startsWith("loc:confirm:")) {
          return void (await handleConfirm(interaction, interaction.customId.slice("loc:confirm:".length)));
        }
      } else if (interaction.isStringSelectMenu()) {
        if (interaction.customId === "loc:zone") return void (await handleZoneSelect(interaction));
        if (interaction.customId.startsWith("loc:place:")) return void (await handlePlaceSelect(interaction));
      }
    } catch (err) {
      console.error("interactionCreate handler failed:", err);
    }
  },
};
