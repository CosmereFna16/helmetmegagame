const { prisma } = require("../index");

// Locations are created with null discordCategoryId/channel IDs — actual
// Discord provisioning is a separate, explicit GM action from
// /gm/dev/zones (web/app/(app)/gm/dev/actions.js#provisionLocationChannels),
// never automatic.
const ZONES = [
  { name: "Town", locations: ["church", "sanctuary", "inn", "town square", "fields"] },
  { name: "Fortress", locations: ["keep", "garrison", "lifeweb", "catacombs"] },
  { name: "Windlands", locations: ["Six-Spoked Wheel Camp", "Broken Spears Camp", "Bastard's Camp"] },
  { name: "Caves", locations: [] },
];

async function main() {
  for (const { name, locations } of ZONES) {
    let zone = await prisma.zone.findFirst({ where: { name } });
    if (zone) {
      console.log(`skip (exists): zone ${name}`);
    } else {
      zone = await prisma.zone.create({ data: { name } });
      console.log(`created: zone ${name}`);
    }

    for (const locationName of locations) {
      const existing = await prisma.location.findFirst({ where: { name: locationName, zoneId: zone.id } });
      if (existing) {
        console.log(`  skip (exists): location ${locationName}`);
        continue;
      }
      await prisma.location.create({ data: { name: locationName, zoneId: zone.id } });
      console.log(`  created: location ${locationName}`);
    }
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch((err) => {
    console.error(err);
    prisma.$disconnect();
    process.exit(1);
  });
