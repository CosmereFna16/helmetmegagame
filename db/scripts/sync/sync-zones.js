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
  console.log(`reconciled (topic + slowmode + permissions + tags): ${summary.reconciled}`);
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
  console.log(`create-a-topic posts: ${fmt(summary.anchors)}`);
  console.log(`private anchors: ${fmt(summary.privateAnchors)}`);
  console.log(
    `location topics: ${fmt(summary.topics)}` +
      (summary.topics.moved.length > 0 ? `, moved: ${summary.topics.moved.join(", ")}` : ""),
  );
  if (summary.topicsPruned.length > 0) {
    console.log(`topics pruned: ${summary.topicsPruned.join(", ")}`);
  }
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
