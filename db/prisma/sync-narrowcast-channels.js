// Provisioning + reconciliation for the special channels registry
// (#watch/#intercom and future siblings). Run with
// `npm run db:sync-narrowcast-channels`. Safe to re-run — channel identity is
// one-time, everything else (topic, overwrites, zone-role view grants)
// reconciles. Run it AFTER db:sync-zones so the zone roles it grants view to
// exist.
require("dotenv").config();
const { prisma, syncSpecialChannels } = require("../index");

async function main() {
  const stats = await syncSpecialChannels(prisma);
  if (stats.provisioned.length > 0) console.log(`provisioned: ${stats.provisioned.join(", ")}`);
  if (stats.reparented.length > 0) console.log(`reparented: ${stats.reparented.join(", ")}`);
  console.log(`zone-role view grants applied: ${stats.roleGrants}`);
  console.log("special channels reconciled");
}

main()
  .then(() => prisma.$disconnect())
  .catch((err) => {
    console.error(err);
    prisma.$disconnect();
    process.exit(1);
  });
