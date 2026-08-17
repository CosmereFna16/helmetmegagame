const { ChannelType } = require("discord.js");
const { prisma } = require("@lifeweb/db");

// Channels are marked by name instead of a manually-curated ID list — any
// channel with "»" in its name opts in, so GMs manage this by renaming
// channels in Discord rather than through a separate config UI. Location
// channels (see locationChannelIds below) opt in by Discord ID instead,
// since their names are auto-generated at provisioning time.
const MARKER = "»";

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
  if (locationChannelIds.tupperSummary.has(channel.id)) return true;
  return channel.name?.includes(MARKER) ?? false;
}

function isTupperChannel(channel) {
  if (channel.type !== ChannelType.GuildText && channel.type !== ChannelType.GuildForum) return false;
  if (locationChannelIds.tupperSummary.has(channel.id) || locationChannelIds.tupperOnly.has(channel.id)) return true;
  return channel.name?.includes(MARKER) ?? false;
}

// Messages inside a forum thread (or a location's private-thread channel)
// report the thread as message.channel, so tupper-proxying has to check the
// parent channel's marker/ID instead.
function isDesignatedTupperChannel(channel) {
  if (isTupperChannel(channel)) return true;
  if (channel.isThread() && channel.parent) {
    if (channel.parent.type === ChannelType.GuildForum && channel.parent.name?.includes(MARKER)) return true;
    if (
      locationChannelIds.tupperSummary.has(channel.parent.id) ||
      locationChannelIds.tupperOnly.has(channel.parent.id)
    ) {
      return true;
    }
  }
  return false;
}

function getSummaryChannels(guild) {
  return [...guild.channels.cache.values()].filter(isSummaryChannel);
}

// The single channel gameplay actually happens in — exact name match, not
// marker-based like isSummaryChannel/isTupperChannel, since there's only
// ever meant to be one.
function isTurnsChannel(channel) {
  return channel.type === ChannelType.GuildText && channel.name?.toLowerCase() === "turns";
}

function getTurnsChannel(guild) {
  return [...guild.channels.cache.values()].find(isTurnsChannel) ?? null;
}

// The single channel the zone/location travel picker lives in (see
// bot/src/lib/location.js) — same exact-name-match convention as
// isTurnsChannel, since there's only ever meant to be one.
function isLocationPromptChannel(channel) {
  return channel.type === ChannelType.GuildText && channel.name?.toLowerCase() === "location";
}

module.exports = {
  MARKER,
  isSummaryChannel,
  isTupperChannel,
  isDesignatedTupperChannel,
  getSummaryChannels,
  isTurnsChannel,
  getTurnsChannel,
  isLocationPromptChannel,
  refreshLocationChannels,
};
