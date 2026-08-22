const { ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const { prisma, buildNarrowcastContext, computeNarrowcastAccess } = require("@lifeweb/db");
const { performTravel } = require("@lifeweb/db/lib/travel");
const { isTravelFree } = require("@lifeweb/db/lib/travelCost");
const { isLocationPromptChannel } = require("./channels");

const FLEUR_EMOJI = "⚜️";
const LOCATION_PROMPT_TEXT = "» Where would you like to move? You can only travel to a directly connected location — changing Zones takes a turn.";

function buildOpenButtonRow() {
  const button = new ButtonBuilder()
    .setCustomId("loc:open")
    .setEmoji(FLEUR_EMOJI)
    .setLabel("Move")
    .setStyle(ButtonStyle.Secondary);
  return new ActionRowBuilder().addComponents(button);
}

// `locations` are the destinations to offer — either the character's
// current Location's direct neighbors, or (first-ever placement, no
// Location yet) every Location in the game. `from` is the character's
// current Location ({ slug, zoneId }) or null; each option's description
// notes whether picking it will be free or spend the turn, asking the same
// isTravelFree the server will ask on confirm — skipped when there's no
// current Location, since every choice is free then.
function buildLocationSelectRow(locations, from) {
  const menu = new StringSelectMenuBuilder()
    .setCustomId("loc:place")
    .setPlaceholder("Choose a location...")
    .addOptions(
      locations.map((l) => ({
        label: l.name,
        value: l.id,
        ...(from
          ? {
              description: isTravelFree({
                fromSlug: from.slug,
                fromZoneId: from.zoneId,
                toSlug: l.slug,
                toZoneId: l.zoneId,
              })
                ? "Free"
                : "Costs your turn",
            }
          : {}),
      })),
    );
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

// Reconciles a character's personal-role overwrites on the narrowcast
// channels (#radio, #intercom) against their current tags/Location — see
// db/lib/narrowcastAccess.js for the actual rules and
// web/lib/discordGuild.js#syncCharacterNarrowcastAccess for the REST twin
// (used by GM raw edits and tag grant/revoke, which only ever happen through
// the web app). Called after every location change (performMove, below).
async function syncCharacterNarrowcastAccess(guild, character) {
  if (!character.discordRoleId) return;
  const role = await getRole(guild, character.discordRoleId);
  if (!role) return;

  const [ctx, config] = await Promise.all([
    buildNarrowcastContext(prisma, character.id),
    prisma.gameConfig.findUnique({ where: { id: 1 } }),
  ]);
  const access = computeNarrowcastAccess(ctx);
  const channelIds = { radio: config?.radioChannelId, intercom: config?.intercomChannelId };

  await Promise.all(
    Object.entries(channelIds)
      .filter(([, channelId]) => channelId)
      .map(async ([slug, channelId]) => {
        const channel = await getChannel(guild, channelId);
        if (!channel) return;
        const grant = access[slug];
        if (grant) {
          await channel.permissionOverwrites
            .edit(role, { ViewChannel: grant.view || grant.send || null, SendMessages: grant.send || null })
            .catch(() => {});
        } else {
          await channel.permissionOverwrites.delete(role).catch(() => {});
        }
      }),
  );
}

// Executes a validated location change. The validation, the free-vs-paid
// decision and the database writes all live in db/lib/travel.js so the web
// app's Map panel runs the identical rules; this wrapper only adds the
// gateway-side Discord work performTravel deliberately leaves to its
// caller. Returns { ok: true, free } or { ok: false, reason }.
async function performMove(guild, character, targetLocation) {
  const result = await performTravel(prisma, character, targetLocation);
  if (!result.ok) return result;

  await swapLocationAccess(guild, character.discordRoleId, result.oldLocation, targetLocation);
  await syncCharacterNarrowcastAccess(guild, character);

  return { ok: true, free: result.free };
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
  buildLocationSelectRow,
  buildConfirmRow,
  swapLocationAccess,
  performMove,
  ensureLocationPrompt,
};
