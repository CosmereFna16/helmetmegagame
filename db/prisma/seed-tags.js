const { prisma } = require("../index");

const CATEGORIES = ["Placeholder 1", "Placeholder 2", "Placeholder 3"];
const COSTS = [10, 9, 8, 7, 6, 5, 4, 3, 2, 1];

function buildTags() {
  const tags = [];
  for (const category of CATEGORIES) {
    COSTS.forEach((cost, i) => {
      const n = i + 1;
      tags.push({
        name: `${category} Tag ${n}`,
        description: `Placeholder description for ${category.toLowerCase()} tag #${n}, worth ${cost} tag point${cost === 1 ? "" : "s"}.`,
        category,
        pointCost: cost,
      });
    });
  }
  return tags;
}

async function main() {
  for (const tag of buildTags()) {
    const existing = await prisma.tag.findFirst({ where: { name: tag.name } });
    if (existing) {
      console.log(`skip (exists): ${tag.name}`);
      continue;
    }
    await prisma.tag.create({ data: tag });
    console.log(`created: ${tag.name} (${tag.pointCost})`);
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch((err) => {
    console.error(err);
    prisma.$disconnect();
    process.exit(1);
  });
