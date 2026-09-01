// One-off: retires the Quick Learner tag and pays its holders back.
//
// The tag ("People teach you skills easier. When learning a skill, you succeed
// on a 5 or 6.", 5 points) has been pulled from the game and removed from
// docs/tags.yaml. syncTagsFromYaml is upsert-only, so dropping the YAML entry
// on its own leaves the row sitting in the database, still held by everyone who
// bought it — this deletes it and refunds the holders.
//
// Refund is 60% of the price: 5 * 0.6 = 3 tagPoints, flat, to EVERY holder.
// That includes the one who got it as an EVENT grant rather than paying for it;
// a flat rate was the call, and the alternative reads as a punishment for
// having been handed something.
//
// Nothing else in the catalog points at this tag — it is nobody's parentTag or
// requiredTag, gates no TagGroup, and is named by no Role, Document, or
// consumesInto/expiresInto entry — so the delete needs no repointing pass the
// way backfill-fighting-split.js did.
//
// Safe to re-run: once the Tag row is gone there is nothing left to find, and
// the row is only deleted inside the same transaction that pays the refunds.
require("dotenv").config();
const { prisma } = require("../index");

const SLUG = "quick-learner";
const REFUND = 3; // 60% of the tag's 5-point price, and it divides evenly.

async function main() {
  const tag = await prisma.tag.findUnique({ where: { slug: SLUG } });
  if (!tag) {
    console.log(`no "${SLUG}" row — already retired, or a fresh database`);
    return;
  }

  const holdings = await prisma.characterTag.findMany({
    where: { tagId: tag.id },
    select: { character: { select: { id: true, name: true, tagPoints: true } } },
  });
  const holders = holdings.map((h) => h.character);

  await prisma.$transaction([
    prisma.characterTag.deleteMany({ where: { tagId: tag.id } }),
    ...holders.map((c) =>
      prisma.character.update({
        where: { id: c.id },
        data: { tagPoints: { increment: REFUND } },
      }),
    ),
    prisma.tag.delete({ where: { id: tag.id } }),
  ]);

  for (const c of holders) {
    console.log(`  ${c.name}: ${c.tagPoints} -> ${c.tagPoints + REFUND}`);
  }
  console.log(
    `"${tag.name}" deleted — refunded ${REFUND} point(s) to ${holders.length} holder(s)`,
  );
}

main()
  .then(() => prisma.$disconnect())
  .catch((err) => {
    console.error(err);
    prisma.$disconnect();
    process.exit(1);
  });
