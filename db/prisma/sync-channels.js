// Manual, terminal-invoked sync from docs/channels.yaml -> the
// SpecialChannel table + the live Discord channels and their gate roles.
// Run with `npm run db:sync-channels`. Also called from wipeGameData's
// "Restart Game" flow (web/app/(app)/gm/dev/actions.js).
//
// Run AFTER db:sync-tags — every gate references a Tag by slug.
require("dotenv").config();
const { prisma, syncSpecialChannelsFromYaml } = require("../index");

async function main() {
  const s = await syncSpecialChannelsFromYaml(prisma);
  console.log(`channels created: ${s.created}`);
  console.log(`channels updated: ${s.updated}`);
  if (s.provisioned.length) console.log(`provisioned in Discord: ${s.provisioned.join(", ")}`);
}

main()
  .then(() => prisma.$disconnect())
  .catch((err) => {
    console.error(err);
    prisma.$disconnect();
    process.exit(1);
  });
