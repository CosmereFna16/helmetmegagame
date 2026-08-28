// One-off backfill: retires the old `radio-system` / `radio-bracelet` Tag
// rows in favour of `radio-system-watch` / `radio-bracelet-watch`.
//
// Both were renamed in docs/tags.yaml (name and slug) as part of the Caves
// Update. syncTagsFromYaml matches on slug and is upsert-only, so the sync
// creates the two new rows and leaves the old ones sitting there — still
// held by every Watchman who bought or was granted one, still the target of
// db/lib/specialChannels.js's #watch gate (updated to the new slugs), and
// still whatever docs/roles.yaml's starting_tags used to name. This moves
// every holder across and deletes both orphans.
//
// Run AFTER `npm run db:sync-tags` (the new rows have to exist first) and
// `npm run db:sync-roles` (so newly-created Watchmen already get the new
// name). Safe to re-run: once both old slugs are gone it's a no-op.
require("dotenv").config();
const { prisma } = require("../index");

const RENAMES = [
  { oldSlug: "radio-system", newSlug: "radio-system-watch" },
  { oldSlug: "radio-bracelet", newSlug: "radio-bracelet-watch" },
];

async function backfillOne(oldSlug, newSlug) {
  const [oldTag, newTag] = await Promise.all([
    prisma.tag.findUnique({ where: { slug: oldSlug } }),
    prisma.tag.findUnique({ where: { slug: newSlug } }),
  ]);

  if (!oldTag) {
    console.log(`nothing to do for "${oldSlug}" (already backfilled, or a fresh database)`);
    return;
  }
  if (!newTag) {
    throw new Error(`no "${newSlug}" row — run npm run db:sync-tags first`);
  }

  // Anyone somehow holding both collides on @@unique([characterId, tagId]);
  // the old holding is simply dropped rather than crashing the script.
  const holders = await prisma.characterTag.findMany({
    where: { tagId: oldTag.id },
    select: { id: true, characterId: true },
  });
  const alreadyHaveNew = new Set(
    (
      await prisma.characterTag.findMany({
        where: { tagId: newTag.id, characterId: { in: holders.map((h) => h.characterId) } },
        select: { characterId: true },
      })
    ).map((ct) => ct.characterId),
  );
  const toMove = holders.filter((h) => !alreadyHaveNew.has(h.characterId));
  const toDrop = holders.filter((h) => alreadyHaveNew.has(h.characterId));

  const gated = await prisma.tag.findMany({
    where: { requirementSkills: { some: { id: oldTag.id } } },
    select: { id: true, slug: true },
  });

  await prisma.$transaction([
    prisma.characterTag.updateMany({
      where: { id: { in: toMove.map((h) => h.id) } },
      data: { tagId: newTag.id },
    }),
    prisma.characterTag.deleteMany({ where: { id: { in: toDrop.map((h) => h.id) } } }),
    ...gated.map((tag) =>
      prisma.tag.update({
        where: { id: tag.id },
        data: { requirementSkills: { disconnect: { id: oldTag.id }, connect: { id: newTag.id } } },
      }),
    ),
    prisma.tag.updateMany({ where: { parentTagId: oldTag.id }, data: { parentTagId: newTag.id } }),
    prisma.tag.updateMany({ where: { requiredTagId: oldTag.id }, data: { requiredTagId: newTag.id } }),
    prisma.tagGroup.updateMany({ where: { requiredTagId: oldTag.id }, data: { requiredTagId: newTag.id } }),
    prisma.tag.delete({ where: { id: oldTag.id } }),
  ]);

  console.log(`"${oldSlug}" -> "${newSlug}": moved ${toMove.length} holder(s), dropped ${toDrop.length} duplicate(s)`);
}

async function main() {
  for (const { oldSlug, newSlug } of RENAMES) {
    await backfillOne(oldSlug, newSlug);
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch((err) => {
    console.error(err);
    prisma.$disconnect();
    process.exit(1);
  });
