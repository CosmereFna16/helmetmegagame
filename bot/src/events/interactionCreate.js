const { MessageFlags } = require("discord.js");
const { prisma } = require("@lifeweb/db");
const {
  buildZoneSelectRow,
  buildLocationSelectRow,
  buildConfirmRow,
  performMove,
} = require("../lib/location");

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
      if (interaction.isButton()) {
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
