const { prisma } = require("../index");

const FACTIONS = [
  "Ravenheart Court",
  "Watch",
  "Church",
  "Sanctuary",
  "Order of the Silver Cross",
  "Ravenheart Village",
  "Warcamp",
  "Brigands",
  "Unaffiliated",
];

function slug(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

async function main() {
  for (const name of FACTIONS) {
    const existing = await prisma.faction.findFirst({ where: { name } });
    if (existing) {
      console.log(`skip (exists): ${name}`);
      continue;
    }
    await prisma.faction.create({
      data: { name, discordRoleId: `seed:${slug(name)}` },
    });
    console.log(`created: ${name}`);
  }

  const unaffiliated = await prisma.faction.findFirst({ where: { name: "Unaffiliated" } });
  const backfilled = await prisma.character.updateMany({
    where: { factionId: null },
    data: { factionId: unaffiliated.id },
  });
  console.log(`backfilled ${backfilled.count} character(s) with no faction into Unaffiliated`);
}

main()
  .then(() => prisma.$disconnect())
  .catch((err) => {
    console.error(err);
    prisma.$disconnect();
    process.exit(1);
  });
