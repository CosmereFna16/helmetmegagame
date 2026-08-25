// One-off backfill: grants the Cursed role read-only visibility on every
// already-provisioned Location outside the Depths, plus both narrowcast
// channels — and strips it from the Depths, where ghosts must stay blind.
//
// Provisioning now sets this overwrite for anything NEW
// (db/lib/syncLocations.js#baseOverwrites,
// db/lib/syncNarrowcastChannels.js), but per CLAUDE.md provisioning is
// one-time and never re-runs for a Location that already has Discord
// channels — so everything that existed before this change needs it applied
// directly. An ordinary `npm run db:sync-locations` also reconciles it now,
// which makes this script the fast, Discord-only path rather than the only
// one.
//
// Unlike backfill-spectator-access.js, this walks the CATEGORY AND ALL THREE
// CHANNELS. The long header on syncLocations.js#locationChannelSpec explains
// why: a channel is "synced" to its category by copying its overwrites once
// at creation and drifts independently afterwards, so a category-only pass
// can silently reach nothing a player would notice. baseOverwrites names
// every target for the same reason.
//
// Safe to re-run.
require("dotenv").config();
const { prisma } = require("../index");
const { applyCursedOverwrite, removeCursedOverwrite, ghostsMaySee, cursedRoleId } = require("../lib/cursedAccess");

async function main() {
  if (!process.env.DISCORD_TOKEN) {
    console.error("DISCORD_TOKEN must be set.");
    process.exit(1);
  }
  if (!cursedRoleId()) {
    console.error("DISCORD_CURSED_ROLE_ID must be set — there is no ghost seat to apply.");
    process.exit(1);
  }

  const locations = await prisma.location.findMany({
    where: { discordCategoryId: { not: null } },
    include: { zone: true },
    orderBy: { slug: "asc" },
  });

  let granted = 0;
  let cleared = 0;
  for (const location of locations) {
    const targets = [
      location.discordCategoryId,
      location.discordChannelId,
      location.discordPublicChannelId,
      location.discordPrivateChannelId,
    ].filter(Boolean);
    const visible = ghostsMaySee(location);
    const label = `${location.zone?.name ?? "?"} / ${location.name}`;

    try {
      for (const channelId of targets) {
        if (visible) await applyCursedOverwrite(channelId);
        else await removeCursedOverwrite(channelId);
      }
      if (visible) granted += 1;
      else cleared += 1;
      console.log(`  ${visible ? "✓" : "–"} ${label}${visible ? "" : " (Depths, ghosts stay blind)"}`);
    } catch (err) {
      console.error(`  ✗ ${location.name}: ${err.message}`);
    }
  }
  console.log(`locations opened to ghosts: ${granted}, kept dark: ${cleared}, of ${locations.length}`);

  const config = await prisma.gameConfig.findUnique({ where: { id: 1 } });
  for (const [label, channelId] of [
    ["#radio", config?.radioChannelId],
    ["#intercom", config?.intercomChannelId],
  ]) {
    if (!channelId) {
      console.log(`  – ${label} not provisioned, skipped`);
      continue;
    }
    try {
      await applyCursedOverwrite(channelId);
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
