// One-off: deletes the Ascetic tag and strips it from everyone holding it.
//
// The tag ("You don't want anything. You gain tag points slowly.", -6 points)
// was cut in the 2026-09-02 sign-off pass, restored the same day alongside the
// `ascetic` Desire family and sit-in-bliss, and then pulled again for good.
// syncTagsFromYaml is upsert-only, so dropping the YAML entry on its own leaves
// the row sitting in the database, still held by everyone who took it — and its
// `all: true` lock would go on closing their whole Desire catalog against a
// family that no longer has any members. This deletes it outright.
//
// NO POINT CHANGE, on purpose. retire-quick-learner.js next door refunds its
// holders because that tag was worth points to have; Ascetic was a -6 drawback,
// so the mirror-image move would be a CLAWBACK of 6 from each holder, which
// DESIRES.md §7 does prescribe when a drawback is cured. This is not a cure —
// the tag is being retracted by design, on the game's initiative and not the
// player's — so the holders keep what they were paid for carrying it. Two of
// the seven sit at 0 and 1 points and would have gone straight to -6 and -5 for
// a decision that was never theirs.
//
// The catalog no longer points at this tag by the time this runs: db:sync-tags
// clears the five conflictsWith edges that named it, and db:sync-desires drops
// meet-theb-etter's requiresAnyTags link and retires sit-in-bliss. Run both
// first, in that order, or the delete races a sync that is still resolving the
// slug.
//
// Safe to re-run: once the Tag row is gone there is nothing left to find.
require("dotenv").config();
const { prisma } = require("../index");

const SLUG = "ascetic";

async function main() {
  const tag = await prisma.tag.findUnique({ where: { slug: SLUG } });
  if (!tag) {
    console.log(`no "${SLUG}" row — already retired, or a fresh database`);
    return;
  }

  const holdings = await prisma.characterTag.findMany({
    where: { tagId: tag.id },
    select: { character: { select: { name: true, tagPoints: true } } },
  });
  const holders = holdings.map((h) => h.character);

  await prisma.$transaction([
    prisma.characterTag.deleteMany({ where: { tagId: tag.id } }),
    prisma.tag.delete({ where: { id: tag.id } }),
  ]);

  for (const c of holders) {
    console.log(`  ${c.name}: keeps ${c.tagPoints} point(s)`);
  }
  console.log(
    `"${tag.name}" deleted — stripped from ${holders.length} holder(s), no point change`,
  );
}

main()
  .then(() => prisma.$disconnect())
  .catch((err) => {
    console.error(err);
    prisma.$disconnect();
    process.exit(1);
  });
