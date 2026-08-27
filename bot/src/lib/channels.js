const { ChannelType } = require("discord.js");
const { prisma, SPECIAL_CHANNELS } = require("@lifeweb/db");

// Tupper/summary status is zone-channel-ID-based (see locationChannelIds
// below) — a channel opts in by being a zone's summary/public/private channel
// (or a cave level's forum), provisioned by db/lib/syncZones.js — plus the
// special channels (#watch, #intercom, db/lib/specialChannels.js), which are
// tupper-only, never summary: they aren't tied to a place, so there's no
// zone adjudication result to post there.

// Refreshed on bot ready and every 5 minutes after — Zone rows and the
// special channel ids change rarely (sync-time provisioning), so a periodic
// in-memory refresh is plenty fresh without a DB round trip on every
// message.
let locationChannelIds = { tupperSummary: new Set(), tupperOnly: new Set() };

// channelId -> { zoneId, zoneName, channelKind }, the same refresh feeding
// the Sets above. It exists so the proxy can stamp an archive row with where
// a message was said, and so the mention relay can gate a ping on the
// speaker's zone, both without a DB round trip per message. The special
// channels are in here too with a null zone — they aren't tied to a place,
// which is exactly what makes the relay fall through to their own access
// rules (see db/lib/specialChannels.js).
let channelContexts = new Map();

async function refreshLocationChannels() {
  const [zones, config] = await Promise.all([
    prisma.zone.findMany({
      select: {
        id: true,
        name: true,
        discordSummaryChannelId: true,
        discordPublicChannelId: true,
        discordPrivateChannelId: true,
      },
    }),
    prisma.gameConfig.findUnique({ where: { id: 1 } }),
  ]);
  const tupperSummary = new Set();
  const tupperOnly = new Set();
  const contexts = new Map();
  const note = (channelId, context) => {
    if (channelId) contexts.set(channelId, context);
  };

  for (const zone of zones) {
    if (zone.discordSummaryChannelId) tupperSummary.add(zone.discordSummaryChannelId);
    if (zone.discordPublicChannelId) tupperSummary.add(zone.discordPublicChannelId);
    if (zone.discordPrivateChannelId) tupperOnly.add(zone.discordPrivateChannelId);
    const place = { zoneId: zone.id, zoneName: zone.name };
    note(zone.discordSummaryChannelId, { ...place, channelKind: "summary" });
    note(zone.discordPublicChannelId, { ...place, channelKind: "public" });
    note(zone.discordPrivateChannelId, { ...place, channelKind: "private" });
  }
  const nowhere = { zoneId: null, zoneName: null };
  for (const entry of SPECIAL_CHANNELS) {
    const channelId = config?.[entry.configKey];
    if (!channelId) continue;
    if (entry.tupper) tupperOnly.add(channelId);
    note(channelId, { ...nowhere, channelKind: entry.slug });
  }

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
    zoneId: context?.zoneId ?? null,
    zoneName: context?.zoneName ?? null,
    channelKind: context?.channelKind ?? null,
    threadName: isThread ? (channel.name ?? null) : null,
    // The id a jump link needs: the thread's own id when this is a thread,
    // else the channel's. Snapshotted by the archive writer — no FK.
    discordChannelId: channel.id ?? null,
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

module.exports = {
  isSummaryChannel,
  isTupperChannel,
  isDesignatedTupperChannel,
  getSummaryChannels,
  refreshLocationChannels,
  resolveChannelContext,
};
