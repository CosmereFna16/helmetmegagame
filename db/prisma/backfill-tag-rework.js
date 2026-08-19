// One-off cleanup for the tag catalog rework (see docs/systemdocs/TAGS.md).
// Run once, after the schema migration that adds TagGroup/Tag's new fields
// but BEFORE the first `npm run db:sync-tags` and before the follow-up
// migration that tightens Tag.slug/category to NOT NULL. Safe to re-run —
// every step is a no-op once already applied.
//
//   1. Backfill Character.isTreasurer for anyone currently holding the
//      "treasurer" CharacterTag, so no one silently loses Treasurer status
//      now that Treasurer is becoming a plain boolean (see
//      web/lib/factionPermissions.js, web/app/(app)/faction/actions.js).
//   2. Delete CharacterTag rows for the "leader"/"treasurer"/"courtier" tags
//      (must happen before step 3 or the FK delete fails).
//   3. Delete the "leader"/"treasurer"/"courtier" Tag rows themselves —
//      Leader is already fully covered by the existing Character.isLeader
//      boolean, Treasurer by the new isTreasurer from step 1, and Courtier
//      had no live mechanic beyond gating the now-ungated Manor tag.
//   4. Delete every placeholder Tag row from the old seed-tags.js
//      buildTags() generator (category starting with "Placeholder") and any
//      CharacterTag rows referencing them.
require("dotenv").config();
const { prisma } = require("../index");

const RETIRED_SLUGS = ["leader", "treasurer", "courtier"];

async function main() {
  const treasurerTag = await prisma.tag.findUnique({ where: { slug: "treasurer" } });
  let treasurerBackfilled = 0;
  if (treasurerTag) {
    const holders = await prisma.characterTag.findMany({
      where: { tagId: treasurerTag.id },
      select: { characterId: true },
    });
    for (const { characterId } of holders) {
      await prisma.character.update({ where: { id: characterId }, data: { isTreasurer: true } });
      treasurerBackfilled += 1;
    }
  }

  const retiredTags = await prisma.tag.findMany({ where: { slug: { in: RETIRED_SLUGS } } });
  const retiredTagIds = retiredTags.map((t) => t.id);
  const retiredCharacterTagsDeleted = retiredTagIds.length
    ? (await prisma.characterTag.deleteMany({ where: { tagId: { in: retiredTagIds } } })).count
    : 0;
  const retiredTagsDeleted = retiredTagIds.length
    ? (await prisma.tag.deleteMany({ where: { id: { in: retiredTagIds } } })).count
    : 0;

  const placeholderTags = await prisma.tag.findMany({ where: { category: { startsWith: "Placeholder" } } });
  const placeholderTagIds = placeholderTags.map((t) => t.id);
  const placeholderCharacterTagsDeleted = placeholderTagIds.length
    ? (await prisma.characterTag.deleteMany({ where: { tagId: { in: placeholderTagIds } } })).count
    : 0;
  const placeholderTagsDeleted = placeholderTagIds.length
    ? (await prisma.tag.deleteMany({ where: { id: { in: placeholderTagIds } } })).count
    : 0;

  console.log(`isTreasurer backfilled: ${treasurerBackfilled}`);
  console.log(`retired tags deleted (leader/treasurer/courtier): ${retiredTagsDeleted}`);
  console.log(`retired CharacterTag rows deleted: ${retiredCharacterTagsDeleted}`);
  console.log(`placeholder tags deleted: ${placeholderTagsDeleted}`);
  console.log(`placeholder CharacterTag rows deleted: ${placeholderCharacterTagsDeleted}`);
}

main()
  .then(() => prisma.$disconnect())
  .catch((err) => {
    console.error(err);
    prisma.$disconnect();
    process.exit(1);
  });
