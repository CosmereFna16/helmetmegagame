// One-off backfill: retires the old `medical-excellent` Tag row in favour of
// `medical-expert`.
//
// The third rung of the Medical ladder was renamed in docs/tags.yaml, slug and
// all. syncTagsFromYaml matches on slug and is upsert-only, so the sync creates
// the new row and leaves the old one sitting there — still holding every
// character who had bought it, still the parent of nothing, and still the
// target of any requirementSkills written against it. This moves all of that
// across and deletes the orphan.
//
// Run AFTER `npm run db:sync-tags` (the new row has to exist first). Safe to
// re-run: once the old slug is gone it's a no-op.
require("dotenv").config();
const { prisma } = require("../index");

const OLD_SLUG = "medical-excellent";
const NEW_SLUG = "medical-expert";

async function main() {
  const [oldTag, newTag] = await Promise.all([
    prisma.tag.findUnique({ where: { slug: OLD_SLUG } }),
    prisma.tag.findUnique({ where: { slug: NEW_SLUG } }),
  ]);

  if (!oldTag) {
    console.log(`nothing to do: no "${OLD_SLUG}" row (already backfilled, or a fresh database)`);
    return;
  }
  if (!newTag) {
    throw new Error(`no "${NEW_SLUG}" row — run npm run db:sync-tags first`);
  }

  // Anyone holding BOTH would collide on @@unique([characterId, tagId]).
  // Nobody should (the two are the same rung of one replacing chain), but the
  // duplicate's old row is simply dropped rather than crashing the script.
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

  // requirementSkills is the many-to-many every cure cost points at. Repoint
  // it before the delete, or the affliction loses its skill gate entirely and
  // quietly becomes treatable by anyone.
  const gated = await prisma.tag.findMany({
    where: { requirementSkills: { some: { id: oldTag.id } } },
    select: { id: true, slug: true },
  });

  const childTiers = await prisma.tag.findMany({
    where: { parentTagId: oldTag.id },
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

  console.log(`moved ${toMove.length} holder(s), dropped ${toDrop.length} duplicate(s)`);
  console.log(`repointed ${gated.length} cure requirement(s): ${gated.map((t) => t.slug).join(", ") || "none"}`);
  console.log(`repointed ${childTiers.length} child tier(s): ${childTiers.map((t) => t.slug).join(", ") || "none"}`);
  console.log(`deleted "${OLD_SLUG}" — the ladder is now Basic -> Skilled -> Expert`);
}

main()
  .then(() => prisma.$disconnect())
  .catch((err) => {
    console.error(err);
    prisma.$disconnect();
    process.exit(1);
  });
