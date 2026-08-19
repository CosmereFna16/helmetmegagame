// Manual, terminal-invoked sync from docs/tags.yaml -> DB. Run with
// `npm run db:sync-tags`. Never runs automatically on its own, but the same
// logic (db/lib/syncTags.js#syncTagsFromYaml) is also called from
// wipeGameData's "Restart Game" flow (web/app/(app)/gm/dev/actions.js) so a
// reset lands the Tag catalog on the canonical set from docs/tags.yaml.
require("dotenv").config();
const { prisma, syncTagsFromYaml } = require("../index");

async function main() {
  const summary = await syncTagsFromYaml(prisma);
  console.log(`groups created: ${summary.groupsCreated}`);
  console.log(`groups updated: ${summary.groupsUpdated}`);
  console.log(`tags created: ${summary.tagsCreated}`);
  console.log(`tags updated: ${summary.tagsUpdated}`);
  console.log(`parent/required links updated: ${summary.linksUpdated}`);
}

main()
  .then(() => prisma.$disconnect())
  .catch((err) => {
    console.error(err);
    prisma.$disconnect();
    process.exit(1);
  });
