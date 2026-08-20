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
