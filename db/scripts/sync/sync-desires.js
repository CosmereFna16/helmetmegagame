// Manual, terminal-invoked sync from docs/desires.yaml -> DB. Run with
// `npm run db:sync-desires`. Never runs automatically on its own, but the
// same logic (db/lib/syncDesires.js#syncDesiresFromYaml) is also called
// from wipeGameData's "Restart Game" flow (web/app/(app)/gm/dev/actions.js)
// so a reset lands the DesireTemplate catalog on the canonical set from
// docs/desires.yaml. Run AFTER db:sync-tags and db:sync-roles — desires
// validate their requires.anyTags/notTags and anyRoles/notRoles against the
// DB, not the YAML.
require("dotenv").config();
const { prisma, syncDesiresFromYaml } = require("../../index");

async function main() {
  const summary = await syncDesiresFromYaml(prisma);
  console.log(`templates created: ${summary.created}`);
  console.log(`templates updated: ${summary.updated}`);
  console.log(`links updated: ${summary.linksUpdated}`);
  console.log(`templates retired: ${summary.retired}`);
  console.log(`templates unretired: ${summary.unretired}`);
}

main()
  .then(() => prisma.$disconnect())
  .catch((err) => {
    console.error(err);
    prisma.$disconnect();
    process.exit(1);
  });
