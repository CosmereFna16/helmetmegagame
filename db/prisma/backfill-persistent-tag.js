// One-off backfill: adds the "Persistent" (⏰) forum tag to every already-
// provisioned Location's public forum channel — new ones get it at creation
// time (web/app/(app)/gm/dev/actions.js#provisionLocationChannels,
// db/prisma/sync-locations.js), this is only for the ones that predate that.
// Safe to re-run: ensureForumTag checks for the tag by name before PATCHing.
require("dotenv").config();
const { prisma } = require("../index");
const { ensureForumTag } = require("../lib/discordRest");

async function main() {
  const locations = await prisma.location.findMany({ where: { discordPublicChannelId: { not: null } } });

  for (const location of locations) {
    await ensureForumTag(location.discordPublicChannelId, "Persistent", "⏰");
    console.log(`tagged: ${location.name}`);
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
