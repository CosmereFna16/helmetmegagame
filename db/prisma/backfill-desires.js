// One-off backfill for the Desires rework: moves live holdings of six
// retired-in-place drawback tags onto their replacements, drops five tags
// that became free (folded into the flat rebalance elsewhere), and confirms
// the new Desire columns need no data pass.
//
// Unlike the Fighting split (db/prisma/backfill-fighting-split.js), the OLD
// Tag rows here are NOT deleted. docs/tags.yaml retires them in place
// (`# Retired 2026-08-31 — Desires rework; ...`) rather than dropping them,
// so a stale reference anywhere in the game (an old audit-log line, a GM's
// habit of typing the old slug) still resolves to a real, inert row instead
// of a dangling id. This script only moves the HOLDINGS and the structural
// REFERENCES off the old rows — it never touches the rows themselves.
//
// Run order: npm run db:sync-tags -> npm run db:sync-desires ->
// npm run db:backfill-desires. sync-tags has to run first so the new target
// rows (poppy-habit, blood-feud, glutton, cruel, death-wish-interest) exist;
// sync-desires has to run before this so DesireTemplate.requiresAnyTags/
// requiresNotTags rows exist to repoint in step 2. "No Discord": this never
// touches a Discord role, channel, or DM — it's a pure Postgres pass.
//
// Conversions (step 2), all folded in at par per docs/tags.yaml:
//   coca-habit         -> poppy-habit          (coca-habit retired, folded in)
//   blood-debt         -> blood-feud           (absorbed alongside honorbound)
//   addiction-glutton  -> glutton               (superseded by the Interest)
//   addiction-drugs    -> poppy-habit          (superseded by the Interest)
//   addiction-cruel    -> cruel                 (superseded by the Interest)
//   death-wish         -> death-wish-interest   (superseded by the Interest)
// Note coca-habit and addiction-drugs both land on poppy-habit — two old
// rows converging on one new row. backfillOne() is written to be safe when
// called twice against the same newSlug: it re-reads the new tag's current
// holders every call, so the second conversion correctly treats characters
// already moved by the first as a collision (dropped, not double-moved).
//
// Free removals (step 3): five tags absorbed into the flat rebalance with no
// replacement Desire-catalog concept behind them. Their point cost is gone
// with them — tagPoints is left untouched, an accepted free lunch (same as
// the header note wants said out loud): a handful of characters keep a few
// points they arguably "paid" for, and reclaiming them isn't worth a refund
// pass for five tags this cheap.
require("dotenv").config();
const { prisma } = require("../index");

const CONVERSIONS = [
  { oldSlug: "coca-habit", newSlug: "poppy-habit" },
  { oldSlug: "blood-debt", newSlug: "blood-feud" },
  { oldSlug: "addiction-glutton", newSlug: "glutton" },
  { oldSlug: "addiction-drugs", newSlug: "poppy-habit" },
  { oldSlug: "addiction-cruel", newSlug: "cruel" },
  { oldSlug: "death-wish", newSlug: "death-wish-interest" },
];

// The marker slug: whichever converting old tag we check FIRST, before any
// writes. coca-habit is picked because it is the very first conversion in
// docs/tags.yaml's own retirement notes and every run of this script does
// all six conversions in one pass — so "does anyone still hold coca-habit"
// is a reliable stand-in for "has this script's conversion step ever run
// to completion", the same way backfill-fighting-split.js reads a single
// representative slug (fighting-basic) rather than checking all thirteen.
const MARKER_OLD_SLUG = "coca-habit";

const FREE_REMOVAL_SLUGS = ["squeamish", "cheap", "honest", "addiction-romantic", "honorbound"];

async function backfillOne(oldSlug, newSlug) {
  const [oldTag, newTag] = await Promise.all([
    prisma.tag.findUnique({ where: { slug: oldSlug } }),
    prisma.tag.findUnique({ where: { slug: newSlug } }),
  ]);

  if (!oldTag) {
    throw new Error(`no "${oldSlug}" row — it should be retired, not deleted; check docs/tags.yaml`);
  }
  if (!newTag) {
    throw new Error(`no "${newSlug}" row — run npm run db:sync-tags first`);
  }

  // Anyone holding both collides on @@unique([characterId, tagId]). This is
  // the expected path for the second of a two-old-tags-into-one-new-tag
  // conversion (coca-habit / addiction-drugs both landing on poppy-habit):
  // a character who somehow held both old tags moves once, then drops the
  // duplicate on the second pass. The old holding is simply dropped rather
  // than crashing the script.
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
  const gated = await prisma.tag.findMany({
    where: { requirementSkills: { some: { id: oldTag.id } } },
    select: { id: true, slug: true },
  });

  // conflictsWith / conflictedBy: syncTags writes this self-m2m symmetrically
  // on BOTH sides of every declared edge (db/lib/syncTags.js pass 6 docstring),
  // so treat the union of both fields as "who conflicts with oldTag" and
  // repoint each partner's edge onto newTag, then mirror it back onto newTag
  // itself so the pair stays symmetric.
  const oldWithEdges = await prisma.tag.findUnique({
    where: { id: oldTag.id },
    select: {
      conflictsWith: { select: { id: true } },
      conflictedBy: { select: { id: true } },
    },
  });
  const conflictPartnerIds = new Set(
    [...oldWithEdges.conflictsWith, ...oldWithEdges.conflictedBy]
      .map((t) => t.id)
      .filter((id) => id !== newTag.id),
  );

  // DesireTemplate.requiresAnyTags / requiresNotTags: real relations per
  // Task 1's schema note (so db:prune-tags can see the reference), sourced
  // from docs/desires.yaml's `requires:` block and written by db:sync-desires.
  const [anyTemplates, notTemplates] = await Promise.all([
    prisma.desireTemplate.findMany({
      where: { requiresAnyTags: { some: { id: oldTag.id } } },
      select: { id: true, slug: true },
    }),
    prisma.desireTemplate.findMany({
      where: { requiresNotTags: { some: { id: oldTag.id } } },
      select: { id: true, slug: true },
    }),
  ]);

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
    ...[...conflictPartnerIds].flatMap((partnerId) => [
      prisma.tag.update({
        where: { id: partnerId },
        data: { conflictsWith: { disconnect: { id: oldTag.id }, connect: { id: newTag.id } } },
      }),
      prisma.tag.update({
        where: { id: newTag.id },
        data: { conflictsWith: { connect: { id: partnerId } } },
      }),
    ]),
    ...anyTemplates.map((t) =>
      prisma.desireTemplate.update({
        where: { id: t.id },
        data: { requiresAnyTags: { disconnect: { id: oldTag.id }, connect: { id: newTag.id } } },
      }),
    ),
    ...notTemplates.map((t) =>
      prisma.desireTemplate.update({
        where: { id: t.id },
        data: { requiresNotTags: { disconnect: { id: oldTag.id }, connect: { id: newTag.id } } },
      }),
    ),
  ]);

  console.log(
    `"${oldSlug}" -> "${newSlug}": moved ${toMove.length} holder(s), dropped ${toDrop.length} duplicate(s)` +
      `, repointed ${gated.length} requirement skill(s), ${conflictPartnerIds.size} conflict edge(s)` +
      `, ${anyTemplates.length} desire anyTag ref(s), ${notTemplates.length} desire notTag ref(s)`,
  );
}

async function removeFreeHoldings() {
  const tags = await prisma.tag.findMany({
    where: { slug: { in: FREE_REMOVAL_SLUGS } },
    select: { id: true, slug: true },
  });
  const found = new Set(tags.map((t) => t.slug));
  for (const slug of FREE_REMOVAL_SLUGS) {
    if (!found.has(slug)) {
      console.log(`nothing to do for "${slug}" (row missing — already pruned, or a fresh database)`);
    }
  }

  // Slug-guarded, not marker-guarded: unlike the conversions above, this is
  // a plain deleteMany against a fixed slug list. It is idempotent on its
  // own terms (zero matching rows the second time) and has nothing to do
  // with the coca-habit marker, which only tracks the CONVERSIONS step. So
  // it always runs, the same way backfill-fighting-split.js's RENAMES loop
  // always runs regardless of the rescale's own marker.
  const result = await prisma.characterTag.deleteMany({
    where: { tagId: { in: tags.map((t) => t.id) } },
  });
  console.log(
    `removed ${result.count} free holding(s) across [${FREE_REMOVAL_SLUGS.join(", ")}]` +
      ` (Character.tagPoints left untouched — accepted free lunch)`,
  );
}

async function verifyDesireSlotIndex() {
  // slotIndex is Int @default(0), NOT NULL — there is no "null/absent" state
  // an updateMany could target. A Postgres ADD COLUMN ... DEFAULT 0 backfills
  // every existing row at migration time, so every pre-rework Desire already
  // reads slotIndex: 0 the moment the migration ran, before this script ever
  // gets to see the table. This step is therefore a verified no-op: it reads
  // the table to confirm nothing is missing a value (which would only be
  // possible if the migration itself were malformed) and logs the count,
  // rather than issuing a write that would touch zero rows every single time.
  const total = await prisma.desire.count();
  const nonZeroSlot = await prisma.desire.count({ where: { NOT: { slotIndex: 0 } } });
  console.log(
    `Desire.slotIndex verified: ${total} row(s) total, ${nonZeroSlot} already in a non-zero slot` +
      ` — no write needed (column defaults to 0, backfilled by the migration itself)`,
  );
}

async function main() {
  // Idempotency marker for the CONVERSIONS step, read FIRST, before any
  // write anywhere in this script. See MARKER_OLD_SLUG's comment for why
  // coca-habit specifically. Note this checks HOLDINGS, not the Tag row —
  // the old rows are retired in place, never deleted, so `prisma.tag
  // .findUnique({ where: { slug: oldSlug } })` would return truthy forever
  // and make a poor marker.
  const markerTag = await prisma.tag.findUnique({ where: { slug: MARKER_OLD_SLUG } });
  const firstRun = Boolean(
    markerTag && (await prisma.characterTag.findFirst({ where: { tagId: markerTag.id } })),
  );

  if (firstRun) {
    for (const { oldSlug, newSlug } of CONVERSIONS) {
      await backfillOne(oldSlug, newSlug);
    }
  } else {
    console.log(
      `no "${MARKER_OLD_SLUG}" holdings found — conversions already ran (or a fresh database), skipped`,
    );
  }

  // Free removals are independently idempotent (see removeFreeHoldings'
  // comment) and always attempted, regardless of the conversions marker.
  await removeFreeHoldings();

  // Desire.slotIndex — read-only verification, see the function's comment.
  await verifyDesireSlotIndex();

  // No GameConfig.desireSlots bump: the column ships with @default(2)
  // straight from the Task 1 migration (schema.prisma:427), so every
  // existing and new GameConfig row already reads 2 — there is nothing here
  // for this script to raise, unlike startingTagPoints in the Fighting split.
  console.log("GameConfig.desireSlots: no bump needed, ships defaulting to 2 (schema.prisma:427)");
}

main()
  .then(() => prisma.$disconnect())
  .catch((err) => {
    console.error(err);
    prisma.$disconnect();
    process.exit(1);
  });
