require("dotenv").config();
const { prisma } = require("../index");
const {
  HUNGERLESS_SLUG,
  FOLLOWER_OF_BACCHUS_SLUG,
  LEADER_SLUG,
  TREASURER_SLUG,
  NOBILITY_SLUG,
  ATE_MEAL_SLUG,
  TIPSY_SLUG,
  ALCOHOLIC_SLUG,
  MORTUS_SLUG,
  DRAINED_SLUG,
  RADIO_SLUG,
  COURTIER_SLUG,
  MANOR_SLUG,
  ARTHRITIS_SLUG,
  LABORER_SLUG,
  LABORER_FARMING_SLUG,
  LABORER_FISHING_SLUG,
  LABORER_HERDING_SLUG,
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
  {
    name: "Alcoholic",
    slug: ALCOHOLIC_SLUG,
    description: "Built up a tolerance — immune to Tipsy's combat penalty.",
    category: "Meta",
    pointCost: 0,
  },
];

// Given as a starting tag to every role in the Windlands (see docs/ROLES.md)
// and also purchasable on their own.
const WINDLANDS_TAGS = [
  {
    name: "Windlander",
    slug: "windlander",
    description:
      "You may move and live freely in the Windlands. Additionally, weather conditions restrict you less than a normal person.",
    category: "Skills",
    pointCost: 1,
  },
  {
    name: "Sign Language",
    slug: "sign-language",
    description: "You know sign language, the ancestral language of the Windlanders.",
    category: "Skills",
    pointCost: 1,
  },
];

// Companion tags. Windlander (Horse) requires Windlander; the Follower (*)
// tags require Follower — neither prerequisite is store-enforced, just
// noted in the description, same as most other role/tag prerequisites in
// docs/ROLES.md.
const COMPANION_TAGS = [
  {
    name: "Windlander (Horse)",
    slug: "windlander-horse",
    description:
      "You have a horse and you know how to ride it. Once per day, you may enter an adjacent zone without spending an Effort. Requires Windlander.",
    category: "Companions",
    pointCost: 1,
  },
  {
    name: "Horse",
    slug: "horse",
    description:
      "You have a horse and you know how to ride it. Once per day, you may enter an adjacent zone without spending an Effort, but you will be easily visible.",
    category: "Companions",
    pointCost: 2,
  },
  {
    name: "Bird",
    slug: "bird",
    description: "You have a highly-trained bird.",
    category: "Companions",
    pointCost: 2,
  },
  {
    name: "Dog",
    slug: "dog",
    description: "You have a highly-trained dog. It has a good sense of smell.",
    category: "Companions",
    pointCost: 2,
  },
  {
    name: "Follower",
    slug: "follower",
    description: "You have a follower, servant, or friend. You control them.",
    category: "Companions",
    pointCost: 2,
  },
  {
    name: "Follower (Cook)",
    slug: "follower-cook",
    description: "Your follower has the Cooking (Basic) tag. Requires Follower.",
    category: "Companions",
    pointCost: 1,
  },
  {
    name: "Follower (Laborer)",
    slug: "follower-laborer",
    description: "Your follower has the Laborer tag. Requires Follower.",
    category: "Companions",
    pointCost: 1,
  },
  {
    name: "Follower (Goon)",
    slug: "follower-goon",
    description: "Your follower has the Fighting (Basic) tag. Requires Follower.",
    category: "Companions",
    pointCost: 1,
  },
];

// Purchasable like a Skill (see SKILL_CATEGORY below) rather than GM-granted
// — buying it flips the character's personal Discord role's access to
// #radio (see RADIO_SLUG, web/lib/discordGuild.js#syncCharacterRadioAccess,
// called from purchaseTags()/grantTag()/revokeTag()).
const RADIO_TAG = {
  name: "Radio",
  slug: RADIO_SLUG,
  description: "Grants access to the #radio channel.",
  category: "Skills",
  pointCost: 2,
};

// Purchasable, but gated behind already holding the Courtier tag — see the
// "Courtier" entry in web/lib/tagStore.js's TAG_STORE_CATEGORIES.
const MANOR_TAG = {
  name: "Manor",
  slug: MANOR_SLUG,
  description: "A household of your own within the Fortress.",
  category: "Courtier",
  pointCost: 2,
};

// Purchasable — a mid-tier bonus to Farming/Fishing/Herding production (see
// docs/documents.yaml's "production" doc), between what anyone can produce
// and what a full specialist manages. The three specializations below are
// gated behind already holding this — see the "Laborer" entry in
// web/lib/tagStore.js's TAG_STORE_CATEGORIES — and bump that one trade up to
// a dedicated Farmer/Fisherman/Herder's rate.
const LABORER_TAG = {
  name: "Laborer",
  slug: LABORER_SLUG,
  description: "Works harder than most at every trade — a middling bonus to Farming, Fishing, and Herding production.",
  category: "Skills",
  pointCost: 2,
};

const LABORER_SPECIALIZATION_TAGS = [
  {
    name: "Laborer (Farming)",
    slug: LABORER_FARMING_SLUG,
    description: "Specializes in Farming — produces at a dedicated farmer's rate.",
    category: "Laborer",
    pointCost: 2,
  },
  {
    name: "Laborer (Fishing)",
    slug: LABORER_FISHING_SLUG,
    description: "Specializes in Fishing — produces at a dedicated fisherman's rate.",
    category: "Laborer",
    pointCost: 2,
  },
  {
    name: "Laborer (Herding)",
    slug: LABORER_HERDING_SLUG,
    description: "Specializes in Herding — produces at a dedicated herder's rate.",
    category: "Laborer",
    pointCost: 2,
  },
];

// System-granted, auto-expiring status markers (see CharacterTag.expiresTurn
// and the tag sweep in resolveNeeds(), db/index.js) — never purchasable or
// GM-granted by hand, just a visible record of a temporary effect already
// tracked elsewhere on the character (skipNextMealConsumption, moodState).
const STATUS_TAGS = [
  {
    name: "Ate Meal",
    slug: ATE_MEAL_SLUG,
    description: "Won't go hungry next turn — ate a proper meal this turn.",
    category: "Status",
    pointCost: 0,
  },
  {
    name: "Tipsy",
    slug: TIPSY_SLUG,
    description: "Immune to Unhappy for 4 turns. Slightly worse at combat.",
    category: "Status",
    pointCost: 0,
  },
  {
    name: "Drained",
    slug: DRAINED_SLUG,
    description: "You are weak and your vision is blurry.",
    category: "Health",
    pointCost: 0,
  },
];

// Non-purchasable markers for role identity, granted by hand from a role's
// "starting tag" (see docs/ROLES.md) rather than through the tag store.
const ROLE_TAGS = [
  {
    name: "Mortus",
    slug: MORTUS_SLUG,
    description: "One of the Mortii — tends to the dead and to the Lifeweb beneath Ravenheart.",
    category: "Role",
    pointCost: 0,
  },
  {
    name: "Courtier",
    slug: COURTIER_SLUG,
    description: "A member of the Baron's court — unlocks the Manor tag in the store.",
    category: "Role",
    pointCost: 0,
  },
  {
    name: "Arthritis",
    slug: ARTHRITIS_SLUG,
    description: "Stiff, aching joints — a lifetime of wear catching up with you.",
    category: "Health",
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
      { tier: "Trained", slug: "fighting-trained", pointCost: 2, description: "Formally trained combat — a Watchman's or Sheriff's baseline." },
      { tier: "Skilled", slug: "fighting-skilled", pointCost: 2, description: "A seasoned fighter, dangerous in a real fight." },
      { tier: "Expert", slug: "fighting-expert", pointCost: 2, description: "A master of arms — few in the barony can match them blade for blade." },
      { tier: "Legendary", slug: "fighting-legendary", pointCost: 2, description: "A living legend of combat, spoken of in the same breath as the barony's greatest champions." },
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
      {
        tier: "Basic",
        slug: "brewing-basic",
        pointCost: 2,
        description: "Can brew basic alcohol (beer, ale, mead) and basic tonics.",
      },
      {
        tier: "Skilled",
        slug: "brewing-skilled",
        pointCost: 2,
        description:
          "Can brew advanced alcohol (wine and other refined drinks) and advanced tonics, which call for hard-to-find ingredients.",
      },
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
        // Description/visibility are safe to keep in sync even for a tag
        // that already exists — unlike pointCost/parentTagId, they can't
        // disrupt anything a character already bought or was granted.
        const changes = {};
        if (existing.description !== description) changes.description = description;
        if (!existing.visibleOnInspect) changes.visibleOnInspect = true;
        if (Object.keys(changes).length > 0) {
          await prisma.tag.update({ where: { id: existing.id }, data: changes });
          console.log(`updated: ${name}`);
        } else {
          console.log(`skip (exists): ${name}`);
        }
        parentId = existing.id;
        continue;
      }
      const created = await prisma.tag.create({
        data: {
          name,
          slug,
          description,
          category: SKILL_CATEGORY,
          pointCost,
          parentTagId: parentId,
          visibleOnInspect: true,
        },
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
  for (const tag of [
    ...buildTags(),
    ...META_TAGS,
    RADIO_TAG,
    MANOR_TAG,
    LABORER_TAG,
    ...LABORER_SPECIALIZATION_TAGS,
    ...WINDLANDS_TAGS,
    ...COMPANION_TAGS,
    ...FACTION_TAGS,
    ...STATUS_TAGS,
    ...ROLE_TAGS,
  ]) {
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
