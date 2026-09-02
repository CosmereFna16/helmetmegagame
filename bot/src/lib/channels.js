const { ChannelType } = require("discord.js");
const { prisma, SPECIAL_CHANNELS } = require("@lifeweb/db");

// Tupper/summary status is channel-ID-based (see channelIds below) — a
// channel opts in by being a zone's #summary or a Location's own channel,
// provisioned by db/lib/syncZones.js — plus the special channels (#watch,
// #intercom, #mindlink, db/lib/specialChannels.js), which are tupper-only,
// never summary: they aren't tied to a place, so there's no zone adjudication
// result to post there.

// Refreshed on bot ready and every 5 minutes after — Location rows and the
// special channel ids change rarely (sync-time provisioning), so a periodic
// in-memory refresh is plenty fresh without a DB round trip on every message.
let channelIds = { tupperSummary: new Set(), tupperOnly: new Set() };

// channelId -> { zoneId, zoneName, locationId, locationName, channelKind },
// the same refresh feeding the Sets above. It exists so the proxy can stamp
// an archive row with where a message was said, and so the mention relay can
// gate a ping on the speaker's LOCATION, both without a DB round trip per
// message. The special channels are in here too with no place at all, which
// is exactly what makes the relay fall through to their own access rules
// (see db/lib/specialChannels.js).
let channelContexts = new Map();

async function refreshLocationChannels() {
  const [zones, locations, config] = await Promise.all([
    prisma.zone.findMany({ select: { id: true, name: true, discordSummaryChannelId: true } }),
    prisma.location.findMany({
      select: {
        id: true,
        name: true,
        zoneId: true,
        discordChannelId: true,
        zone: { select: { name: true } },
      },
    }),
    prisma.gameConfig.findUnique({ where: { id: 1 } }),
  ]);
  const tupperSummary = new Set();
  const tupperOnly = new Set();
  const contexts = new Map();
  const nowhere = { zoneId: null, zoneName: null, locationId: null, locationName: null };
  const note = (channelId, context) => {
    if (channelId) contexts.set(channelId, context);
  };

  for (const zone of zones) {
    if (!zone.discordSummaryChannelId) continue;
    tupperSummary.add(zone.discordSummaryChannelId);
    note(zone.discordSummaryChannelId, {
      ...nowhere,
      zoneId: zone.id,
      zoneName: zone.name,
      channelKind: "summary",
    });
  }
  // Every Location channel is a tupper channel and never a summary one: the
  // adjudication summary is posted once per zone, and a location is a room
  // inside it, not a place a turn result lands.
  for (const location of locations) {
    if (!location.discordChannelId) continue;
    tupperOnly.add(location.discordChannelId);
    note(location.discordChannelId, {
      zoneId: location.zoneId,
      zoneName: location.zone?.name ?? null,
      locationId: location.id,
      locationName: location.name,
      channelKind: "location",
    });
  }
  for (const entry of SPECIAL_CHANNELS) {
    const channelId = config?.[entry.configKey];
    if (!channelId) continue;
    if (entry.tupper) tupperOnly.add(channelId);
    note(channelId, { ...nowhere, channelKind: entry.slug });
  }

  channelIds = { tupperSummary, tupperOnly };
  channelContexts = contexts;
}

// Where a message was said, for the archive. A message inside a Room thread
// or a Conversation reports the thread as its channel, so the place comes
// from the parent Location and the thread's own name is kept as the scene it
// belongs to — which is what lets /archive render a thread as one readable
// unit rather than scattered lines under its location.
function resolveChannelContext(channel) {
  const isThread = typeof channel.isThread === "function" && channel.isThread();
  const parentId = isThread ? channel.parent?.id : channel.id;
  const context = parentId ? channelContexts.get(parentId) : null;
  return {
    zoneId: context?.zoneId ?? null,
    zoneName: context?.zoneName ?? null,
    locationId: context?.locationId ?? null,
    locationName: context?.locationName ?? null,
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
  return channelIds.tupperSummary.has(channel.id);
}

function isTupperChannel(channel) {
  if (channel.type !== ChannelType.GuildText) return false;
  return channelIds.tupperSummary.has(channel.id) || channelIds.tupperOnly.has(channel.id);
}

// Messages inside a Room thread or a Conversation report the thread as
// message.channel, so tupper-proxying has to check the parent channel's ID
// instead.
function isDesignatedTupperChannel(channel) {
  if (isTupperChannel(channel)) return true;
  if (channel.isThread() && channel.parent) {
    return channelIds.tupperSummary.has(channel.parent.id) || channelIds.tupperOnly.has(channel.parent.id);
  }
  return false;
}

module.exports = {
  isSummaryChannel,
  isTupperChannel,
  isDesignatedTupperChannel,
  refreshLocationChannels,
  resolveChannelContext,
};
