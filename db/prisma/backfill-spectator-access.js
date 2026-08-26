// One-off backfill: grants the spectator role read-only visibility on every
// already-provisioned Location category and both narrowcast channels.
//
// Provisioning now sets this overwrite for anything NEW
// (db/lib/syncLocations.js#provisionLocationChannels,
// db/lib/syncNarrowcastChannels.js), but per CLAUDE.md provisioning is
// one-time and never re-runs for a Location that already has Discord
// channels — so everything that existed before this change needs it applied
// directly.
//
// Uses PUT /channels/{id}/permissions/{roleId} via applySpectatorOverwrite,
// which adds/updates a single overwrite without touching the channel's
// others. Safe to re-run.
//
// The overwrite goes on the CATEGORY, not the three channels: they inherit
// ViewChannel from it, which is the same mechanism per-character access uses
// and keeps the per-channel overwrite count down.
require("dotenv").config();
const { prisma } = require("../index");
const { applySpectatorOverwrite } = require("../lib/spectatorAccess");

async function main() {
  if (!process.env.DISCORD_TOKEN) {
    console.error("DISCORD_TOKEN must be set.");
    process.exit(1);
  }
  const locations = await prisma.location.findMany({
    where: { discordCategoryId: { not: null } },
    include: { zone: true },
    orderBy: { slug: "asc" },
  });

  let ok = 0;
  for (const location of locations) {
    try {
      await applySpectatorOverwrite(location.discordCategoryId);
      ok += 1;
      console.log(`  ✓ ${location.zone?.name ?? "?"} / ${location.name}`);
    } catch (err) {
      console.error(`  ✗ ${location.name}: ${err.message}`);
    }
  }
  console.log(`categories updated: ${ok}/${locations.length}`);

  const config = await prisma.gameConfig.findUnique({ where: { id: 1 } });
  for (const [label, channelId] of [
    ["#watch", config?.watchChannelId],
    ["#intercom", config?.intercomChannelId],
  ]) {
    if (!channelId) {
      console.log(`  – ${label} not provisioned, skipped`);
      continue;
    }
    try {
      await applySpectatorOverwrite(channelId);
      console.log(`  ✓ ${label}`);
    } catch (err) {
      console.error(`  ✗ ${label}: ${err.message}`);
    }
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch((err) => {
    console.error(err);
    prisma.$disconnect();
    process.exit(1);
  });
