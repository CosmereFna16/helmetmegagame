const { ChannelType } = require("discord.js");

// Channels are marked by name instead of a manually-curated ID list — any
// channel with "»" in its name opts in, so GMs manage this by renaming
// channels in Discord rather than through a separate config UI.
const MARKER = "»";

function isSummaryChannel(channel) {
  return channel.type === ChannelType.GuildText && channel.name?.includes(MARKER);
}

function isTupperChannel(channel) {
  return (
    (channel.type === ChannelType.GuildText || channel.type === ChannelType.GuildForum) &&
    channel.name?.includes(MARKER)
  );
}

// Messages inside a forum thread report the thread as message.channel, so
// tupper-proxying has to check the parent forum channel's name instead.
function isDesignatedTupperChannel(channel) {
  if (isTupperChannel(channel)) return true;
  if (channel.isThread() && channel.parent) {
    return channel.parent.type === ChannelType.GuildForum && channel.parent.name?.includes(MARKER);
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

module.exports = {
  MARKER,
  isSummaryChannel,
  isTupperChannel,
  isDesignatedTupperChannel,
  getSummaryChannels,
  isTurnsChannel,
  getTurnsChannel,
};
