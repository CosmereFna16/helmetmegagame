// One-off backfill: denies ATTACH_FILES for @everyone on every Tupper
// channel (a Location's category, so its plain/public/private channels all
// inherit it — see db/lib/syncLocations.js) plus #radio/#intercom (which set
// their own channel-level @everyone deny directly, see
// db/lib/syncNarrowcastChannels.js), and grants GM an explicit allow so
// moderation posts with attachments still work. Provisioning itself now sets
// both overwrites for any *newly* provisioned Location/narrowcast channel,
// but per CLAUDE.md that provisioning is one-time — so anything already
// provisioned before this change needs it applied directly here.
//
// Uses PUT /channels/{id}/permissions/{targetId}, which replaces only that
// one target's overwrite (not the whole permission_overwrites array), so it
// has to fetch the channel's current overwrite for that target first and
// merge the ATTACH_FILES bit in, rather than clobbering the deny/allow bits
// already there (e.g. the category's existing @everyone VIEW_CHANNEL deny,
// or #radio/#intercom's existing VIEW_CHANNEL+SEND_MESSAGES deny). Safe to
// re-run.
require("dotenv").config();
const { prisma } = require("../index");
const { getChannel, putChannelOverwrite } = require("../lib/discordRest");

const PERM_ATTACH_FILES = 32768n;

function currentBits(channel, targetId, field) {
  const overwrite = channel.permission_overwrites?.find((o) => o.id === targetId);
  return overwrite ? BigInt(overwrite[field] ?? "0") : 0n;
}

async function addDeny(channelId, targetId) {
  const channel = await getChannel(channelId);
  const deny = currentBits(channel, targetId, "deny") | PERM_ATTACH_FILES;
  const allow = currentBits(channel, targetId, "allow");
  await putChannelOverwrite(channelId, targetId, { deny: deny.toString(), allow: allow.toString() });
}

async function addAllow(channelId, targetId) {
  const channel = await getChannel(channelId);
  const allow = currentBits(channel, targetId, "allow") | PERM_ATTACH_FILES;
  const deny = currentBits(channel, targetId, "deny");
  await putChannelOverwrite(channelId, targetId, { allow: allow.toString(), deny: deny.toString() });
}

async function main() {
  const guildId = process.env.DISCORD_GUILD_ID;
  const gmRoleId = process.env.DISCORD_GM_ROLE_ID;
  if (!guildId || !process.env.DISCORD_TOKEN) {
    console.error("DISCORD_GUILD_ID and DISCORD_TOKEN must be set.");
    process.exit(1);
  }

  const locations = await prisma.location.findMany({ where: { discordCategoryId: { not: null } } });
  for (const location of locations) {
    await addDeny(location.discordCategoryId, guildId);
    if (gmRoleId) await addAllow(location.discordCategoryId, gmRoleId);
    console.log(`applied ATTACH_FILES restriction for ${location.name}`);
  }

  const config = await prisma.gameConfig.findUnique({ where: { id: 1 } });
  const narrowcastChannelIds = [config?.radioChannelId, config?.intercomChannelId].filter(Boolean);
  for (const channelId of narrowcastChannelIds) {
    await addDeny(channelId, guildId);
    if (gmRoleId) await addAllow(channelId, gmRoleId);
    console.log(`applied ATTACH_FILES restriction for narrowcast channel ${channelId}`);
  }

  console.log(`done (${locations.length} location(s), ${narrowcastChannelIds.length} narrowcast channel(s) processed)`);
}

main()
  .then(() => prisma.$disconnect())
  .catch((err) => {
    console.error(err);
    prisma.$disconnect();
    process.exit(1);
  });
