const { prisma } = require("../index");

const FACTIONS = [
  "Ravenheart Court",
  "Watch",
  "Church",
  "Sanctuary",
  "Order of the Silver Cross",
  "Ravenheart Village",
  "Brigands",
  "Windrider Clan",
  "Six-Spoke Wheel Clan",
  "Broken Spears Clan",
  "Unaffiliated",
];

async function main() {
  for (const name of FACTIONS) {
    const existing = await prisma.faction.findFirst({ where: { name } });
    if (existing) {
      console.log(`skip (exists): ${name}`);
      continue;
    }
    await prisma.faction.create({
      data: { name },
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
