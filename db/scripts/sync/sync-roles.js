// Manual, terminal-invoked sync from docs/roles.yaml -> the Zone/Faction/Role
// tables. Run with `npm run db:sync-roles`. The same logic
// (db/lib/syncRoles.js#syncRolesFromYaml) is also called from wipeGameData's
// "Restart Game" flow (web/app/(app)/gm/dev/actions.js).
//
// Run AFTER db:sync-locations and db:sync-tags — roles resolve a starting
// Location by slug and validate starting_tags against the Tag catalog, and
// will throw rather than half-apply if either hasn't been synced yet.
//
// `--seed-silos` re-seeds every faction's silo (except Unaffiliated) to its
// computed opening balance, even on an existing row — the same re-seed a
// Restart Game wipe performs. Useful after changing GameConfig.playerCount
// on /gm/dev for a game smaller or bigger than the default 100.
require("dotenv").config();
const { prisma, syncRolesFromYaml } = require("../../index");

async function main() {
  const seedSilos = process.argv.includes("--seed-silos");
  const s = await syncRolesFromYaml(prisma, { seedSilos });
  console.log(`factions created: ${s.factionsCreated}`);
  console.log(`factions updated: ${s.factionsUpdated}`);
  console.log(`roles created: ${s.rolesCreated}`);
  console.log(`roles updated: ${s.rolesUpdated}`);
  if (s.rolesPruned.length) console.log(`roles pruned: ${s.rolesPruned.join(", ")}`);
  if (s.factionsPruned.length) console.log(`factions pruned: ${s.factionsPruned.join(", ")}`);
  if (seedSilos) {
    console.log("silos seeded:");
    for (const { name, silo } of s.seededSilos) console.log(`  ${name}: ${silo}`);
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch((err) => {
    console.error(err);
    prisma.$disconnect();
    process.exit(1);
  });
