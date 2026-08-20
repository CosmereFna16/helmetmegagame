const { ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const { prisma } = require("@lifeweb/db");
const { isLocationPromptChannel } = require("./channels");

const FLEUR_EMOJI = "⚜️";
const LOCATION_PROMPT_TEXT = "» Where would you like to move? Changing Zones takes a turn.";

function buildOpenButtonRow() {
  const button = new ButtonBuilder()
    .setCustomId("loc:open")
    .setEmoji(FLEUR_EMOJI)
    .setLabel("Move")
    .setStyle(ButtonStyle.Secondary);
  return new ActionRowBuilder().addComponents(button);
}

function buildZoneSelectRow(zones) {
  const menu = new StringSelectMenuBuilder()
    .setCustomId("loc:zone")
    .setPlaceholder("Choose a zone...")
    .addOptions(zones.map((z) => ({ label: z.name, value: z.id })));
  return new ActionRowBuilder().addComponents(menu);
}

function buildLocationSelectRow(zoneId, locations) {
  const menu = new StringSelectMenuBuilder()
    .setCustomId(`loc:place:${zoneId}`)
    .setPlaceholder("Choose a location...")
    .addOptions(locations.map((l) => ({ label: l.name, value: l.id })));
  return new ActionRowBuilder().addComponents(menu);
}

function buildConfirmRow(locationId) {
  const confirm = new ButtonBuilder()
    .setCustomId(`loc:confirm:${locationId}`)
    .setLabel("Confirm")
    .setStyle(ButtonStyle.Success);
  const cancel = new ButtonBuilder().setCustomId("loc:cancel").setLabel("Cancel").setStyle(ButtonStyle.Secondary);
  return new ActionRowBuilder().addComponents(confirm, cancel);
}

async function getChannel(guild, channelId) {
  if (!channelId) return null;
  return guild.channels.cache.get(channelId) ?? (await guild.channels.fetch(channelId).catch(() => null));
}

async function getRole(guild, roleId) {
  if (!roleId) return null;
  return guild.roles.cache.get(roleId) ?? (await guild.roles.fetch(roleId).catch(() => null));
}

// The category-level permission overwrite is the sole access-control
// primitive for Locations (see the Location model comment in
// schema.prisma) — child channels inherit ViewChannel from it, so one
// overwrite per character per active Location is all that's needed.
async function swapLocationAccess(guild, characterRoleId, oldLocation, newLocation) {
  const role = await getRole(guild, characterRoleId);
  if (!role) return;

  if (oldLocation?.discordCategoryId) {
    const oldCategory = await getChannel(guild, oldLocation.discordCategoryId);
    await oldCategory?.permissionOverwrites.delete(role).catch(() => {});
  }
  if (newLocation?.discordCategoryId) {
    const newCategory = await getChannel(guild, newLocation.discordCategoryId);
    await newCategory?.permissionOverwrites.edit(role, { ViewChannel: true }).catch(() => {});
  }
}

// Executes a validated zone/location change: free if staying within the
// same zone (or the character has no zone yet), otherwise a turn-consuming
// auto-resolved Move — reuses the existing turn-economy (Action rows scoped
// to the open Turn) rather than a parallel tracker, and the same check
// blocks a second Move submission this turn (see actionSubmission.js).
// Returns { ok: true, free } or { ok: false, reason }.
async function performMove(guild, character, targetLocation) {
  const isFree = !character.zoneId || targetLocation.zoneId === character.zoneId;

  let openTurn = null;
  if (!isFree) {
    const currentZone = await prisma.zone.findUnique({
      where: { id: character.zoneId },
      include: { connectsTo: { where: { id: targetLocation.zoneId } } },
    });
    if (!currentZone || currentZone.connectsTo.length === 0) {
      return { ok: false, reason: "That zone isn't reachable from here." };
    }

    openTurn = await prisma.turn.findFirst({ where: { status: "OPEN" } });
    if (!openTurn) return { ok: false, reason: "No turn is currently open." };

    const existing = await prisma.action.findFirst({
      where: { characterId: character.id, turnId: openTurn.id },
    });
    if (existing) return { ok: false, reason: "You've already acted this turn." };
  }

  const oldLocation = character.locationId
    ? await prisma.location.findUnique({ where: { id: character.locationId } })
    : null;

  await swapLocationAccess(guild, character.discordRoleId, oldLocation, targetLocation);

  await prisma.character.update({
    where: { id: character.id },
    data: { locationId: targetLocation.id, zoneId: targetLocation.zoneId },
  });

  if (!isFree) {
    await prisma.action.create({
      data: {
        characterId: character.id,
        turnId: openTurn.id,
        type: "MOVE",
        status: "CONFIRMED",
        moveReviewStatus: "SOLVED",
        description: `Traveled to ${targetLocation.name}.`,
        zoneId: targetLocation.zoneId,
        resultMessage: `» Traveled to ${targetLocation.name}.`,
        gmNotes: "auto:zone_change",
      },
    });
  }

  return { ok: true, free: isFree };
}

// Locks down the guild's "location" channel (read-only for @everyone — the
// bot can still post) and makes sure exactly one tracked prompt message with
// the Move button exists there, reusing it across restarts rather than
// reposting (unlike postTurnsAnnouncement, which intentionally rolls a new
// message every turn). Called once on bot ready, same spot as the other
// per-guild catch-up syncs (factions, nicknames).
async function ensureLocationPrompt(guild) {
  const channel = [...guild.channels.cache.values()].find(isLocationPromptChannel);
  if (!channel) return;

  await channel.permissionOverwrites.edit(guild.roles.everyone, { SendMessages: false }).catch(() => {});

  const config = await prisma.gameConfig.findUnique({ where: { id: 1 } });
  if (config?.locationPromptChannelId === channel.id && config.locationPromptMessageId) {
    const existing = await channel.messages.fetch(config.locationPromptMessageId).catch(() => null);
    if (existing) return;
  }

  const sent = await channel.send({ content: LOCATION_PROMPT_TEXT, components: [buildOpenButtonRow()] });
  await prisma.gameConfig.update({
    where: { id: 1 },
    data: { locationPromptChannelId: channel.id, locationPromptMessageId: sent.id },
  });
}

module.exports = {
  FLEUR_EMOJI,
  buildOpenButtonRow,
  buildZoneSelectRow,
  buildLocationSelectRow,
  buildConfirmRow,
  swapLocationAccess,
  performMove,
  ensureLocationPrompt,
};
