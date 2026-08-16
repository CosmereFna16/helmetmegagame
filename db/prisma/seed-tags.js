const { prisma } = require("../index");
const {
  HUNGERLESS_SLUG,
  FOLLOWER_OF_BACCHUS_SLUG,
  LEADER_SLUG,
  TREASURER_SLUG,
  NOBILITY_SLUG,
} = require("../lib/constants");

const CATEGORIES = ["Placeholder 1", "Placeholder 2", "Placeholder 3"];
const COSTS = [10, 9, 8, 7, 6, 5, 4, 3, 2, 1];

const META_TAGS = [
  {
    name: "Hungerless",
    slug: HUNGERLESS_SLUG,
    description: "Never flagged hungry, even with insufficient resources.",
    category: "Meta",
    pointCost: 0,
  },
  {
    name: "Follower of Bacchus",
    slug: FOLLOWER_OF_BACCHUS_SLUG,
    description: "Unlocks the Bacchus tag category. Desire completions grant +5 tag points instead of +3.",
    category: "Meta",
    pointCost: 0,
  },
  {
    name: "Nobility",
    slug: NOBILITY_SLUG,
    description:
      "Expects a fine meal at least every 3 turns — go without and it sours into Unhappy until you eat again.",
    category: "Meta",
    pointCost: 0,
  },
];

// Not purchasable (no category in web/lib/tagStore.js's TAG_STORE_CATEGORIES)
// — Leader is granted/revoked automatically alongside Faction.leader status,
// Treasurer is granted/revoked by a faction's Leader (or a GM) from the
// faction panel. Both gate Silo-management controls there.
const FACTION_TAGS = [
  {
    name: "Leader",
    slug: LEADER_SLUG,
    description: "Marks the character as their faction's leader.",
    category: "Faction",
    pointCost: 0,
  },
  {
    name: "Treasurer",
    slug: TREASURER_SLUG,
    description: "Grants control over the faction's Silo — view withdrawal history and transfer resources to faction members.",
    category: "Faction",
    pointCost: 0,
  },
];

// Sequential skill tags — each tier upgrades from (and, once bought/granted,
// replaces) the one before it. See web/app/components/TagStorePanel.js for
// the tier-picker UI and purchaseTags() in web/app/(app)/character/actions.js
// for the replace-on-upgrade logic that reads parentTagId at purchase time.
const SKILL_FAMILIES = [
  {
    family: "Fighting",
    tiers: [
      { tier: "Basic", slug: "fighting-basic", pointCost: 2, description: "Can hold a weapon and defend yourself in a pinch." },
      { tier: "Trained", slug: "fighting-trained", pointCost: 2, description: "Formally trained combat — a Guard's or Sheriff's baseline." },
      { tier: "Skilled", slug: "fighting-skilled", pointCost: 2, description: "A seasoned fighter, dangerous in a real fight." },
    ],
  },
  {
    family: "Medical",
    tiers: [
      { tier: "Basic", slug: "medical-basic", pointCost: 2, description: "Can bandage a wound and treat minor ailments." },
      { tier: "Skilled", slug: "medical-skilled", pointCost: 2, description: "Trained medical care — can treat serious injuries and illness." },
      { tier: "Excellent", slug: "medical-excellent", pointCost: 2, description: "Expert-level medicine, on par with the Sanctuary's own." },
    ],
  },
  {
    family: "Brewing",
    tiers: [
      { tier: "Basic", slug: "brewing-basic", pointCost: 2, description: "Can brew simple potions and drinks." },
      { tier: "Skilled", slug: "brewing-skilled", pointCost: 2, description: "Skilled brewing — reliable potions and drinks worth paying for." },
    ],
  },
  {
    family: "Cooking",
    tiers: [
      { tier: "Basic", slug: "cooking-basic", pointCost: 2, description: "Can put together an edible meal." },
      { tier: "Skilled", slug: "cooking-skilled", pointCost: 2, description: "Skilled cooking — meals worth the coin." },
    ],
  },
];

const SKILL_CATEGORY = "Skills";

async function seedSkillTags() {
  for (const { family, tiers } of SKILL_FAMILIES) {
    let parentId = null;
    for (const { tier, slug, pointCost, description } of tiers) {
      const name = `${family} (${tier})`;
      const existing = await prisma.tag.findFirst({ where: { name } });
      if (existing) {
        console.log(`skip (exists): ${name}`);
        parentId = existing.id;
        continue;
      }
      const created = await prisma.tag.create({
        data: { name, slug, description, category: SKILL_CATEGORY, pointCost, parentTagId: parentId },
      });
      console.log(`created: ${name} (${pointCost})${parentId ? ` <- upgrades from parent` : ""}`);
      parentId = created.id;
    }
  }
}

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
  for (const tag of [...buildTags(), ...META_TAGS, ...FACTION_TAGS]) {
    const existing = await prisma.tag.findFirst({ where: { name: tag.name } });
    if (existing) {
      console.log(`skip (exists): ${tag.name}`);
      continue;
    }
    await prisma.tag.create({ data: tag });
    console.log(`created: ${tag.name} (${tag.pointCost})`);
  }

  await seedSkillTags();
}

main()
  .then(() => prisma.$disconnect())
  .catch((err) => {
    console.error(err);
    prisma.$disconnect();
    process.exit(1);
  });
