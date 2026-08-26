const { ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const { prisma, buildNarrowcastContext, computeNarrowcastAccess } = require("@lifeweb/db");
const { performTravel } = require("@lifeweb/db/lib/travel");
const { isTravelFree } = require("@lifeweb/db/lib/travelCost");
const { locationAccessChannelIds } = require("@lifeweb/db/lib/locationAccess");


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

// The access target is the player's MEMBER, not the character's role. The role
// is a mentionable name token held by nobody — assigning it would put the
// player's account in its member list and deanonymize the game. discord.js
// infers the overwrite type from the class it's handed, so passing a
// GuildMember here is what makes these type-1 overwrites.
//
// A miss means the player has left the guild; no-op, same as the old
// role-missing branch.
async function getMember(guild, discordUserId) {
  if (!discordUserId) return null;
  return guild.members.cache.get(discordUserId) ?? (await guild.members.fetch(discordUserId).catch(() => null));
}

// Grants/revokes a character's ViewChannel on a Location — the category AND
// all three of its channels, never the category alone. Discord copies a
// category's overwrites onto a channel at creation and the two drift apart
// after that, so a grant written only to the category can leave a character
// unable to see the room they are standing in. See db/lib/locationAccess.js.
async function swapLocationAccess(guild, discordUserId, oldLocation, newLocation) {
  const member = await getMember(guild, discordUserId);
  if (!member) return;

  // A failed REVOKE is the one that matters and the one that used to be
  // silent: the character has left the room, and an overwrite that outlives
  // them means they keep reading it. A failed grant announces itself the
  // moment the player looks for the channel; a failed revoke announces itself
  // to nobody. Neither should abort the loop, but both get logged.
  for (const channelId of locationAccessChannelIds(oldLocation)) {
    const channel = await getChannel(guild, channelId);
    if (!channel) continue;
    await channel.permissionOverwrites
      .delete(member)
      .catch((err) =>
        console.error(`Failed to revoke ${member.id}'s access to ${channelId} on leaving:`, err.message),
      );
  }
  for (const channelId of locationAccessChannelIds(newLocation)) {
    const channel = await getChannel(guild, channelId);
    if (!channel) continue;
    await channel.permissionOverwrites
      .edit(member, { ViewChannel: true })
      .catch((err) => console.error(`Failed to grant ${member.id} access to ${channelId}:`, err.message));
  }
}

// Reconciles a character's per-member overwrites on the narrowcast
// channels (#watch, #intercom) against their current tags/Location — see
// db/lib/narrowcastAccess.js for the actual rules and
// web/lib/discordGuild.js#syncCharacterNarrowcastAccess for the REST twin
// (used by GM raw edits and tag grant/revoke, which only ever happen through
// the web app). Called after every location change (performMove, below).
async function syncCharacterNarrowcastAccess(guild, character) {
  const member = await getMember(guild, character.discordUserId);
  if (!member) return;

  const [ctx, config] = await Promise.all([
    buildNarrowcastContext(prisma, character.id),
    prisma.gameConfig.findUnique({ where: { id: 1 } }),
  ]);
  const access = computeNarrowcastAccess(ctx);
  const channelIds = { watch: config?.watchChannelId, intercom: config?.intercomChannelId };

  await Promise.all(
    Object.entries(channelIds)
      .filter(([, channelId]) => channelId)
      .map(async ([slug, channelId]) => {
        const channel = await getChannel(guild, channelId);
        if (!channel) return;
        const grant = access[slug];
        if (grant) {
          await channel.permissionOverwrites
            .edit(member, { ViewChannel: grant.view || grant.send || null, SendMessages: grant.send || null })
            .catch((err) => console.error(`Failed to sync ${member.id}'s #${slug} access:`, err.message));
        } else {
          await channel.permissionOverwrites
            .delete(member)
            .catch((err) => console.error(`Failed to revoke ${member.id}'s #${slug} access:`, err.message));
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

  await swapLocationAccess(guild, character.discordUserId, result.oldLocation, targetLocation);
  await syncCharacterNarrowcastAccess(guild, character);

  return { ok: true, free: result.free };
}

module.exports = {
  buildLocationSelectRow,
  buildConfirmRow,
  swapLocationAccess,
  // Exported for the GM /heal command, which moves a tag and so has to
  // reconcile #watch/#intercom access the same way a Move does.
  syncCharacterNarrowcastAccess,
  performMove,
};
