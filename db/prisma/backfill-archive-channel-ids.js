// One-off backfill: fills ArchiveEntry.discordChannelId for rows written
// before the column existed. The archive writer now snapshots it going
// forward (db/lib/archive.js), but everything recorded earlier only has
// channelKind + locationId to resolve a channel from.
//
// Thread messages (threadName set) never had their thread id captured
// anywhere else in the row, so they are unrecoverable by design and are
// only counted, never touched.
//
// Dry-run by default with an --apply flag, matching db:prune-tags and
// db:prune-orphan-roles.
require("dotenv").config();
const { prisma } = require("../index");

async function main() {
  const apply = process.argv.includes("--apply");

  const locations = await prisma.location.findMany({
    select: {
      id: true,
      discordChannelId: true,
      discordPublicChannelId: true,
      discordPrivateChannelId: true,
    },
  });
  const locationsById = new Map(locations.map((l) => [l.id, l]));
  const config = await prisma.gameConfig.findUnique({
    where: { id: 1 },
    select: { watchChannelId: true, intercomChannelId: true },
  });

  const threadSkipped = await prisma.archiveEntry.count({
    where: { kind: "MESSAGE", discordChannelId: null, threadName: { not: null } },
  });

  const candidates = await prisma.archiveEntry.findMany({
    where: { kind: "MESSAGE", discordChannelId: null, threadName: null },
    select: { id: true, locationId: true, channelKind: true },
  });

  function resolve(row) {
    if (row.channelKind === "watch") return config?.watchChannelId ?? null;
    if (row.channelKind === "intercom") return config?.intercomChannelId ?? null;
    const location = row.locationId ? locationsById.get(row.locationId) : null;
    if (!location) return null;
    if (row.channelKind === "plain") return location.discordChannelId ?? null;
    if (row.channelKind === "public") return location.discordPublicChannelId ?? null;
    if (row.channelKind === "private") return location.discordPrivateChannelId ?? null;
    return null;
  }

  const groups = new Map(); // discordChannelId -> [id, ...]
  let unresolvable = 0;
  for (const row of candidates) {
    const channelId = resolve(row);
    if (!channelId) {
      unresolvable += 1;
      continue;
    }
    if (!groups.has(channelId)) groups.set(channelId, []);
    groups.get(channelId).push(row.id);
  }

  let updated = 0;
  for (const [channelId, ids] of groups) {
    console.log(`${apply ? "set" : "would set"} ${ids.length} rows → ${channelId}`);
    if (apply) {
      await prisma.archiveEntry.updateMany({ where: { id: { in: ids } }, data: { discordChannelId: channelId } });
    }
    updated += ids.length;
  }

  console.log(`\n${apply ? "updated" : "would update"}: ${updated}`);
  console.log(`thread rows skipped (name-only, unrecoverable): ${threadSkipped}`);
  console.log(`unresolvable: ${unresolvable}`);
  if (!apply) console.log("\nDry run — pass --apply to write changes.");

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
