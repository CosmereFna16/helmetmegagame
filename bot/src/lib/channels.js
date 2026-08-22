const { ChannelType } = require("discord.js");
const { prisma } = require("@lifeweb/db");

// Tupper/summary status is Location-channel-ID-based (see locationChannelIds
// below) — a channel opts in by being one of a Location's plain/public/
// private channels, provisioned via
// web/app/(app)/gm/dev/actions.js#provisionLocationChannels — plus the two
// narrowcast channels (#radio, #intercom, GameConfig.radioChannelId/
// intercomChannelId), which are tupper-only, never summary: they aren't tied
// to a place, so there's no Location adjudication result to post there.

// Refreshed on bot ready and every 5 minutes after — Location rows and the
// narrowcast channel ids change rarely (GM provisioning, one-off sync), so a
// periodic in-memory refresh is plenty fresh without a DB round trip on
// every message.
let locationChannelIds = { tupperSummary: new Set(), tupperOnly: new Set() };

// channelId -> { locationId, locationName, channelKind }, the same refresh
// feeding the Sets above. It exists so the proxy can stamp an archive row with
// where a message was said without a DB round trip per message; the narrowcast
// channels are in here too, with a null location, since they aren't tied to a
// place (see db/lib/narrowcastAccess.js).
let channelContexts = new Map();

async function refreshLocationChannels() {
  const [locations, config] = await Promise.all([
    prisma.location.findMany({
      select: {
        id: true,
        name: true,
        discordChannelId: true,
        discordPublicChannelId: true,
        discordPrivateChannelId: true,
      },
    }),
    prisma.gameConfig.findUnique({ where: { id: 1 } }),
  ]);
  const tupperSummary = new Set();
  const tupperOnly = new Set();
  const contexts = new Map();
  const note = (channelId, locationId, locationName, channelKind) => {
    if (channelId) contexts.set(channelId, { locationId, locationName, channelKind });
  };

  for (const loc of locations) {
    if (loc.discordChannelId) tupperSummary.add(loc.discordChannelId);
    if (loc.discordPublicChannelId) tupperSummary.add(loc.discordPublicChannelId);
    if (loc.discordPrivateChannelId) tupperOnly.add(loc.discordPrivateChannelId);
    note(loc.discordChannelId, loc.id, loc.name, "plain");
    note(loc.discordPublicChannelId, loc.id, loc.name, "public");
    note(loc.discordPrivateChannelId, loc.id, loc.name, "private");
  }
  if (config?.radioChannelId) tupperOnly.add(config.radioChannelId);
  if (config?.intercomChannelId) tupperOnly.add(config.intercomChannelId);
  note(config?.radioChannelId, null, null, "radio");
  note(config?.intercomChannelId, null, null, "intercom");

  locationChannelIds = { tupperSummary, tupperOnly };
  channelContexts = contexts;
}

// Where a message was said, for the archive. A message inside a forum post or
// a private thread reports the thread as its channel, so the location comes
// from the parent and the thread's own name is kept as the scene it belongs
// to — which is what lets /archive render a forum post as one readable unit
// rather than scattered lines under its location.
function resolveChannelContext(channel) {
  const isThread = typeof channel.isThread === "function" && channel.isThread();
  const parentId = isThread ? channel.parent?.id : channel.id;
  const context = parentId ? channelContexts.get(parentId) : null;
  return {
    locationId: context?.locationId ?? null,
    locationName: context?.locationName ?? null,
    channelKind: context?.channelKind ?? null,
    threadName: isThread ? (channel.name ?? null) : null,
  };
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
  resolveChannelContext,
};
