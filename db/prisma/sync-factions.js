// Manual, terminal-invoked sync from docs/roles.yaml -> the Faction table.
// See db/lib/factionSync.js for the actual logic (shared with wipeGameData).
// Run with `npm run db:sync-factions`. Never runs automatically.
require("dotenv").config();
const { prisma } = require("../index");
const { syncFactionsFromRolesYaml } = require("../lib/factionSync");

async function main() {
  const entries = await syncFactionsFromRolesYaml(prisma);
  console.log(`Synced ${entries.length} factions from docs/roles.yaml.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
