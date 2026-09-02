// Manual, terminal-invoked sync from docs/zones.yaml -> DB + Discord.
// Run with `npm run db:sync-zones`. Never runs automatically on its own, but
// the same logic (db/lib/syncZones.js#syncZonesFromYaml) is also called from
// wipeGameData's "Restart Game" flow (web/app/(app)/gm/dev/actions.js) so a
// reset lands on the canonical zone set from docs/zones.yaml.
require("dotenv").config();
const { prisma, syncZonesFromYaml } = require("../../index");

async function main() {
  if (!process.env.DISCORD_TOKEN || !process.env.DISCORD_GUILD_ID) {
    console.error("DISCORD_GUILD_ID and DISCORD_TOKEN must be set.");
    process.exit(1);
  }

  const summary = await syncZonesFromYaml(prisma);
  console.log(`zones created: ${summary.zonesCreated}, updated: ${summary.zonesUpdated}`);
  if (summary.rolesCreated.length > 0) {
    console.log(`zone roles created: ${summary.rolesCreated.join(", ")}`);
  }
  if (summary.provisioned.length > 0) {
    console.log(`provisioned: ${summary.provisioned.join(", ")}`);
  } else {
    console.log("no zones needed Discord provisioning");
  }
  console.log(`reconciled (topic + slowmode + permissions): ${summary.reconciled}`);
  if (summary.permissionRepairs.length > 0) {
    console.log(`permission repairs (${summary.permissionRepairs.length}):`);
    for (const repair of summary.permissionRepairs) console.log(`  - ${repair}`);
  } else {
    console.log("permission repairs: none — every channel already matched the spec");
  }
  console.log(`channel order asserted on ${summary.channelsOrdered} channels`);
  if (summary.channelsReparented.length > 0) {
    console.log(`moved back into their category: ${summary.channelsReparented.join(", ")}`);
  }
  const fmt = (s) =>
    `${s.created} created, ${s.updated} updated, ${s.unchanged} unchanged` +
    (s.skipped > 0 ? `, ${s.skipped} skipped` : "");
  console.log(`room threads: ${fmt(summary.rooms)}` + (summary.roomsMoved.length > 0 ? `, recreated: ${summary.roomsMoved.join(", ")}` : ""));
  console.log(`location anchors: ${fmt(summary.anchors)}`);
  console.log(`locations: ${summary.locationsCreated} created, ${summary.locationsUpdated} updated` + (summary.locationsMoved.length > 0 ? `, moved: ${summary.locationsMoved.join(", ")}` : ""));
  if (summary.roomsPruned.length > 0) console.log(`rooms pruned: ${summary.roomsPruned.join(", ")}`);
  if (summary.locationsPruned.length > 0) console.log(`locations pruned (channel + role): ${summary.locationsPruned.join(", ")}`);
  if (summary.pruned.length > 0) {
    console.log(`zones pruned (DB + Discord, role included): ${summary.pruned.join(", ")}`);
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch((err) => {
    console.error(err);
    prisma.$disconnect();
    process.exit(1);
  });
