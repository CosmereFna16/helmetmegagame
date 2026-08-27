const { ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const { prisma, buildNarrowcastContext, computeNarrowcastAccess, SPECIAL_CHANNELS } = require("@lifeweb/db");
const { performTravel } = require("@lifeweb/db/lib/travel");
const { applyPendingInvites } = require("@lifeweb/db/lib/threadInvites");

// `zones` are the destinations to offer — either the character's current
// zone's direct neighbors, or (first-ever placement, no zone yet) every
// presence zone in the game. Every hop costs the Move since the zone rework,
// so the description doesn't need to ask the server anything.
function buildZoneSelectRow(zones, from) {
  const menu = new StringSelectMenuBuilder()
    .setCustomId("zone:place")
    .setPlaceholder("Choose a zone...")
    .addOptions(
      zones.map((z) => ({
        label: z.name,
        value: z.id,
        ...(from ? { description: "Costs your Move" } : {}),
      })),
    );
  return new ActionRowBuilder().addComponents(menu);
}

function buildConfirmRow(zoneId) {
  const confirm = new ButtonBuilder()
    .setCustomId(`zone:confirm:${zoneId}`)
    .setLabel("Confirm")
    .setStyle(ButtonStyle.Success);
  const cancel = new ButtonBuilder().setCustomId("zone:cancel").setLabel("Cancel").setStyle(ButtonStyle.Secondary);
  return new ActionRowBuilder().addComponents(confirm, cancel);
}

async function getChannel(guild, channelId) {
  if (!channelId) return null;
  return guild.channels.cache.get(channelId) ?? (await guild.channels.fetch(channelId).catch(() => null));
}

// A miss means the player has left the guild; no-op, and the doctor's next
// pass reports the drift if it matters.
async function getMember(guild, discordUserId) {
  if (!discordUserId) return null;
  return guild.members.cache.get(discordUserId) ?? (await guild.members.fetch(discordUserId).catch(() => null));
}

// Moves a character's zone ROLE — the whole access model since the rework:
// one "Zone: {Name}" role per presence zone, held by everyone standing
// there, carrying the channel overwrites. Two role calls replace the old
// eight-to-fourteen overwrite writes.
//
// Grant BEFORE revoke, deliberately: an interrupted swap leaves the player
// seeing two zones for a moment (harmless, self-healing) rather than none
// (a lockout a player can't diagnose). Every failure is logged — never a
// bare .catch(() => {}); the doctor reconciles whatever these misses leave.
async function swapZoneRole(guild, discordUserId, oldZone, newZone) {
  const member = await getMember(guild, discordUserId);
  if (!member) return;

  if (newZone?.discordRoleId) {
    await member.roles
      .add(newZone.discordRoleId)
      .catch((err) =>
        console.error(`Failed to grant ${member.id} the ${newZone.name} zone role:`, err.message),
      );
  }
  if (oldZone?.discordRoleId && oldZone.discordRoleId !== newZone?.discordRoleId) {
    await member.roles
      .remove(oldZone.discordRoleId)
      .catch((err) =>
        console.error(`Failed to remove ${member.id}'s ${oldZone.name} zone role:`, err.message),
      );
  }
}

// Reconciles a character's per-member overwrites on the special channels
// (#watch, #intercom, and future registry entries) against their current
// tags/zone — the rules live in db/lib/specialChannels.js, the REST twin in
// web/lib/discordGuild.js#syncCharacterNarrowcastAccess (used by GM raw
// edits and tag grant/revoke, which only ever happen through the web app).
// Called after every zone change (performMove, below).
async function syncCharacterNarrowcastAccess(guild, character) {
  const member = await getMember(guild, character.discordUserId);
  if (!member) return;

  const [ctx, config] = await Promise.all([
    buildNarrowcastContext(prisma, character.id),
    prisma.gameConfig.findUnique({ where: { id: 1 } }),
  ]);
  const access = computeNarrowcastAccess(ctx);

  await Promise.all(
    SPECIAL_CHANNELS.map((entry) => [entry.slug, config?.[entry.configKey]])
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

// Executes a validated zone change. The validation and the database writes
// live in db/lib/travel.js so the web app's Map panel runs the identical
// rules; this wrapper only adds the gateway-side Discord work performTravel
// deliberately leaves to its caller. Returns { ok: true } or
// { ok: false, reason }.
async function performMove(guild, character, targetZone) {
  const result = await performTravel(prisma, character, targetZone);
  if (!result.ok) return result;

  await swapZoneRole(guild, character.discordUserId, result.oldZone, targetZone);
  await syncCharacterNarrowcastAccess(guild, character);
  await applyPendingInvites(prisma, { ...character, zoneId: targetZone.id });

  return { ok: true };
}

module.exports = {
  buildZoneSelectRow,
  buildConfirmRow,
  swapZoneRole,
  // Exported for the GM /heal command, which moves a tag and so has to
  // reconcile #watch/#intercom access the same way a Move does.
  syncCharacterNarrowcastAccess,
  performMove,
};
