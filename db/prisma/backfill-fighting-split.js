// One-off backfill for the Tag Rebalance: retires the old `fighting-*` Tag
// rows in favour of the split Melee / Ranged trees, and rescales the point
// economy on live characters.
//
// docs/tags.yaml replaced the single Fighting tree with `melee-*` and
// `ranged-*`, renamed five sidegrades, and dropped the `fighting-` prefix off
// Grappler / Cavalry / Guerrilla. syncTagsFromYaml matches on slug and is
// upsert-only, so the sync creates the new rows and leaves every old one
// sitting there — still held by every character who bought one, still the
// parent of nothing, and still the target of any weapon's `requiredTag`.
// This moves all of that across and deletes the orphans.
//
// It also does the two point-economy fixes that no sync can do:
//   * every price in docs/tags.yaml was multiplied by 2.25, so each live
//     character's spent-and-earned `tagPoints` balance is multiplied by 2.25
//     (rounded half away from zero) to keep its purchasing power;
//   * `GameConfig.startingTagPoints` goes 6 -> 12, matching the new schema
//     default (migration 20260829120000_starting_points_12).
//
// Run AFTER `npm run db:sync-tags` (the new rows have to exist first) and
// BEFORE `npm run db:sync-roles` / `npm run db:sync-documents` — both of
// those resolve tags by name/slug out of the YAML and will re-point their own
// references once the new rows are in place.
//
// Safe to re-run. The tag renames are no-ops once the old slugs are gone, and
// the tagPoints rescale is guarded on the same thing: it only runs if the old
// `fighting-basic` row still existed when the script started, which is true
// exactly once. `startingTagPoints` is only touched while it still reads 6.
require("dotenv").config();
const { prisma } = require("../index");

const RENAMES = [
  { oldSlug: "fighting-basic", newSlug: "melee-basic" },
  { oldSlug: "fighting-trained", newSlug: "melee-trained" },
  { oldSlug: "fighting-skilled", newSlug: "melee-skilled" },
  { oldSlug: "fighting-expert", newSlug: "melee-expert" },
  { oldSlug: "fighting-legendary", newSlug: "melee-legendary" },
  { oldSlug: "fighting-archer", newSlug: "ranged-archer" },
  { oldSlug: "fighting-firearms", newSlug: "ranged-firearms" },
  { oldSlug: "fighting-shield-wall", newSlug: "melee-shield-wall" },
  { oldSlug: "fighting-duelist", newSlug: "melee-duelist" },
  { oldSlug: "fighting-drunken-master", newSlug: "melee-drunken-master" },
  { oldSlug: "fighting-grappler", newSlug: "grappler" },
  { oldSlug: "fighting-cavalry", newSlug: "cavalry" },
  { oldSlug: "fighting-guerrilla", newSlug: "guerrilla" },
];

const PRICE_SCALE = 2.25;
const OLD_STARTING_POINTS = 6;
const NEW_STARTING_POINTS = 12;

// Same rounding the docs/tags.yaml rescale used: half away from zero.
function scalePoints(value) {
  return Math.sign(value) * Math.round(Math.abs(value) * PRICE_SCALE);
}

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

  // Anyone holding both collides on @@unique([characterId, tagId]). Nothing
  // should produce that (a role sync never re-grants tags to existing
  // characters), but a GM grant could — the old holding is simply dropped
  // rather than crashing the script.
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

  // requirementSkills is the many-to-many every cure/craft cost points at.
  // Repoint it before the delete or the recipe loses its skill gate entirely.
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

  console.log(
    `"${oldSlug}" -> "${newSlug}": moved ${toMove.length} holder(s), dropped ${toDrop.length} duplicate(s)` +
      `, repointed ${gated.length} requirement(s)`,
  );
}

async function rescaleCharacterPoints() {
  const characters = await prisma.character.findMany({
    where: { tagPoints: { not: 0 } },
    select: { id: true, tagPoints: true },
  });
  await prisma.$transaction(
    characters.map((c) =>
      prisma.character.update({ where: { id: c.id }, data: { tagPoints: scalePoints(c.tagPoints) } }),
    ),
  );
  console.log(`rescaled tagPoints on ${characters.length} character(s) by x${PRICE_SCALE}`);
}

async function raiseStartingPoints() {
  const updated = await prisma.gameConfig.updateMany({
    where: { startingTagPoints: OLD_STARTING_POINTS },
    data: { startingTagPoints: NEW_STARTING_POINTS },
  });
  console.log(
    updated.count
      ? `GameConfig.startingTagPoints ${OLD_STARTING_POINTS} -> ${NEW_STARTING_POINTS}`
      : `GameConfig.startingTagPoints left alone (not ${OLD_STARTING_POINTS})`,
  );
}

async function main() {
  // Idempotency marker for the one step that is not slug-driven: if the old
  // Fighting tree is still there, this is the first run and the point balances
  // have not been rescaled yet.
  const firstRun = Boolean(await prisma.tag.findUnique({ where: { slug: "fighting-basic" } }));

  // The rescale runs BEFORE the renames on purpose: the first rename deletes
  // the `fighting-basic` row the marker reads, so if it ran afterwards and a
  // later rename threw, every re-run would see "already done" and skip it —
  // silently leaving every balance on the old scale.
  if (firstRun) {
    await rescaleCharacterPoints();
  } else {
    console.log("tagPoints already rescaled on an earlier run — skipped");
  }

  for (const { oldSlug, newSlug } of RENAMES) {
    await backfillOne(oldSlug, newSlug);
  }

  await raiseStartingPoints();
}

main()
  .then(() => prisma.$disconnect())
  .catch((err) => {
    console.error(err);
    prisma.$disconnect();
    process.exit(1);
  });
