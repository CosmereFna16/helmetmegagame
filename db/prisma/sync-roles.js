// Manual, terminal-invoked sync from docs/roles.yaml -> the Zone/Faction/Role
// tables. Run with `npm run db:sync-roles`. The same logic
// (db/lib/syncRoles.js#syncRolesFromYaml) is also called from wipeGameData's
// "Restart Game" flow (web/app/(app)/gm/dev/actions.js).
//
// Run AFTER db:sync-locations and db:sync-tags — roles resolve a starting
// Location by slug and validate starting_tags against the Tag catalog, and
// will throw rather than half-apply if either hasn't been synced yet.
require("dotenv").config();
const { prisma, syncRolesFromYaml } = require("../index");

async function main() {
  const s = await syncRolesFromYaml(prisma);
  console.log(`factions created: ${s.factionsCreated}`);
  console.log(`factions updated: ${s.factionsUpdated}`);
  console.log(`roles created: ${s.rolesCreated}`);
  console.log(`roles updated: ${s.rolesUpdated}`);
  if (s.rolesPruned.length) console.log(`roles pruned: ${s.rolesPruned.join(", ")}`);
  if (s.factionsPruned.length) console.log(`factions pruned: ${s.factionsPruned.join(", ")}`);
}

main()
  .then(() => prisma.$disconnect())
  .catch((err) => {
    console.error(err);
    prisma.$disconnect();
    process.exit(1);
  });
