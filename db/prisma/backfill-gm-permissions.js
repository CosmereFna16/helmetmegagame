// One-off backfill: adds the GM-role channel-level permission overwrite
// (view/send/delete-any-message/manage-and-create-threads) to every already-
// provisioned Location's plain/public/private channels. Provisioning itself
// (db/lib/syncLocations.js#provisionLocationChannels,
// web/app/(app)/gm/dev/actions.js#provisionLocationChannels) now sets this
// overwrite for any *new* Location, but per CLAUDE.md that provisioning is
// one-time and never re-runs for a Location that already has Discord
// channels — so the Locations that existed before this change need it
// applied directly. Uses `PUT /channels/{id}/permissions/{gmRoleId}`, which
// adds/updates a single overwrite without touching the channel's other
// overwrites (unlike resending the whole permission_overwrites array via
// PATCH /channels/{id}), so it's safe to run alongside the existing
// @everyone deny on -private channels. Safe to re-run.
require("dotenv").config();
const { prisma } = require("../index");

const DISCORD_API = "https://discord.com/api/v10";

const PERM_VIEW_CHANNEL = 1024;
const PERM_SEND_MESSAGES = 2048;
const PERM_MANAGE_MESSAGES = 8192;
const PERM_MANAGE_THREADS = 17179869184;
const PERM_CREATE_PUBLIC_THREADS = 34359738368;
const PERM_CREATE_PRIVATE_THREADS = 68719476736;
const PERM_SEND_MESSAGES_IN_THREADS = 274877906944;

const GM_PLAIN_PERMS = PERM_VIEW_CHANNEL + PERM_SEND_MESSAGES + PERM_MANAGE_MESSAGES;
const GM_PUBLIC_PERMS =
  PERM_VIEW_CHANNEL + PERM_CREATE_PUBLIC_THREADS + PERM_SEND_MESSAGES_IN_THREADS + PERM_MANAGE_THREADS + PERM_MANAGE_MESSAGES;
const GM_PRIVATE_PERMS =
  PERM_VIEW_CHANNEL +
  PERM_SEND_MESSAGES +
  PERM_CREATE_PRIVATE_THREADS +
  PERM_SEND_MESSAGES_IN_THREADS +
  PERM_MANAGE_THREADS +
  PERM_MANAGE_MESSAGES;

async function putGmOverwrite(token, gmRoleId, channelId, allow) {
  const res = await fetch(`${DISCORD_API}/channels/${channelId}/permissions/${gmRoleId}`, {
    method: "PUT",
    headers: { Authorization: `Bot ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ type: 0, allow: String(allow), deny: "0" }),
  });
  if (!res.ok && res.status !== 204) {
    console.error(`  failed on channel ${channelId}: ${res.status} ${await res.text()}`);
  }
}

async function main() {
  const token = process.env.DISCORD_TOKEN;
  const gmRoleId = process.env.DISCORD_GM_ROLE_ID;
  if (!token || !gmRoleId) {
    console.error("DISCORD_TOKEN and DISCORD_GM_ROLE_ID must be set.");
    process.exit(1);
  }

  const locations = await prisma.location.findMany({ where: { discordCategoryId: { not: null } } });

  for (const location of locations) {
    if (location.discordChannelId) await putGmOverwrite(token, gmRoleId, location.discordChannelId, GM_PLAIN_PERMS);
    if (location.discordPublicChannelId) await putGmOverwrite(token, gmRoleId, location.discordPublicChannelId, GM_PUBLIC_PERMS);
    if (location.discordPrivateChannelId) await putGmOverwrite(token, gmRoleId, location.discordPrivateChannelId, GM_PRIVATE_PERMS);
    console.log(`applied GM overwrite for ${location.name}`);
  }

  console.log(`done (${locations.length} location(s) processed)`);
}

main()
  .then(() => prisma.$disconnect())
  .catch((err) => {
    console.error(err);
    prisma.$disconnect();
    process.exit(1);
  });
