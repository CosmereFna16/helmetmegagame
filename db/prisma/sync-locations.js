// Manual, terminal-invoked sync from docs/locations.yaml -> DB + Discord.
// Run with `npm run db:sync-locations`. Never runs automatically on its
// own, but the same logic (db/lib/syncLocations.js#syncLocationsFromYaml)
// is also called from wipeGameData's "Restart Game" flow
// (web/app/(app)/gm/dev/actions.js) so a reset lands on the canonical
// location set from docs/locations.yaml.
require("dotenv").config();
const { prisma, syncLocationsFromYaml } = require("../index");

async function main() {
  if (!process.env.DISCORD_TOKEN || !process.env.DISCORD_GUILD_ID) {
    console.error("DISCORD_GUILD_ID and DISCORD_TOKEN must be set.");
    process.exit(1);
  }

  const summary = await syncLocationsFromYaml(prisma);
  console.log(`zones created: ${summary.zonesCreated}`);
  console.log(`locations created: ${summary.locationsCreated}`);
  console.log(`locations updated: ${summary.locationsUpdated}`);
  if (summary.provisioned.length > 0) {
    console.log(`provisioned: ${summary.provisioned.join(", ")}`);
    console.log("sorted location categories alphabetically");
  } else {
    console.log("no locations needed Discord provisioning");
  }
  // Say what the reconciliation pass actually did. This used to print nothing
  // at all, so a run that repaired every Location and a run that repaired none
  // were indistinguishable — which is most of why a real permissions bug read
  // as "the sync did nothing".
  console.log(`reconciled (topic + permissions): ${summary.reconciled}`);
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
  const posts = summary.descriptionPosts;
  console.log(
    `description posts: ${posts.created} created, ${posts.updated} updated, ${posts.unchanged} unchanged` +
      (posts.skipped > 0 ? `, ${posts.skipped} skipped (no -public forum)` : ""),
  );
  if (summary.pruned.length > 0) {
    console.log(`pruned (deleted from DB + Discord): ${summary.pruned.join(", ")}`);
  }
  if (summary.zonesPruned.length > 0) {
    console.log(`zones pruned: ${summary.zonesPruned.join(", ")}`);
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch((err) => {
    console.error(err);
    prisma.$disconnect();
    process.exit(1);
  });
