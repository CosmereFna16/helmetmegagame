const { ChannelType } = require("discord.js");
const { prisma } = require("@lifeweb/db");

// Tupper/summary status is entirely Location-channel-ID-based (see
// locationChannelIds below) — a channel opts in only by being one of a
// Location's plain/public/private channels, provisioned via
// web/app/(app)/gm/dev/actions.js#provisionLocationChannels.

// Refreshed on bot ready and every 5 minutes after — Location rows change
// rarely (only via GM provisioning), so a periodic in-memory refresh is
// plenty fresh without a DB round trip on every message.
let locationChannelIds = { tupperSummary: new Set(), tupperOnly: new Set() };

async function refreshLocationChannels() {
  const locations = await prisma.location.findMany({
    select: { discordChannelId: true, discordPublicChannelId: true, discordPrivateChannelId: true },
  });
  const tupperSummary = new Set();
  const tupperOnly = new Set();
  for (const loc of locations) {
    if (loc.discordChannelId) tupperSummary.add(loc.discordChannelId);
    if (loc.discordPublicChannelId) tupperSummary.add(loc.discordPublicChannelId);
    if (loc.discordPrivateChannelId) tupperOnly.add(loc.discordPrivateChannelId);
  }
  locationChannelIds = { tupperSummary, tupperOnly };
}
setInterval(() => refreshLocationChannels().catch((err) => console.error("Failed to refresh location channels:", err)), 5 * 60_000);

function isSummaryChannel(channel) {
  if (channel.type !== ChannelType.GuildText) return false;
  return locationChannelIds.tupperSummary.has(channel.id);
}

function isTupperChannel(channel) {
  if (channel.type !== ChannelType.GuildText && channel.type !== ChannelType.GuildForum) return false;
  return locationChannelIds.tupperSummary.has(channel.id) || locationChannelIds.tupperOnly.has(channel.id);
}

// Messages inside a forum thread (or a location's private-thread channel)
// report the thread as message.channel, so tupper-proxying has to check the
// parent channel's ID instead.
function isDesignatedTupperChannel(channel) {
  if (isTupperChannel(channel)) return true;
  if (channel.isThread() && channel.parent) {
    return (
      locationChannelIds.tupperSummary.has(channel.parent.id) || locationChannelIds.tupperOnly.has(channel.parent.id)
    );
  }
  return false;
}

function getSummaryChannels(guild) {
  return [...guild.channels.cache.values()].filter(isSummaryChannel);
}

// The single channel the zone/location travel picker lives in (see
// bot/src/lib/location.js) — same exact-name-match convention as
// isTurnsChannel, since there's only ever meant to be one.
function isLocationPromptChannel(channel) {
  return channel.type === ChannelType.GuildText && channel.name?.toLowerCase() === "location";
}

module.exports = {
  isSummaryChannel,
  isTupperChannel,
  isDesignatedTupperChannel,
  getSummaryChannels,
  isLocationPromptChannel,
  refreshLocationChannels,
};
