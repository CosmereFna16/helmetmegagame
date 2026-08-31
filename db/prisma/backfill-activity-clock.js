// One-off backfill: stamps Character.lastActivityTurn with the current open
// turn for every ALIVE character whose clock is NULL. Run once, right after
// the migration that shipped the characterActivity.js NULL-guard fix.
//
// Why: the debounced writer's `not:` guard excluded NULL rows (Prisma's
// `not: N` is SQL `<>`, NULL-false), so no clock ever got stamped and the
// whole Catatonic (AFK) system sat inert. Starting everyone at the current
// turn means staleness accrues honestly from the day the fix lands — nobody
// is flagged (or, worse, put on the death countdown) for turns that were
// never measured. Safe to re-run: it only touches NULL rows.
require("dotenv").config();
const { prisma } = require("../index");

async function main() {
  const turn =
    (await prisma.turn.findFirst({ where: { status: "OPEN" }, select: { number: true } })) ??
    (await prisma.turn.findFirst({ orderBy: { number: "desc" }, select: { number: true } }));
  if (!turn) {
    console.error("No turn exists yet — nothing to stamp against.");
    process.exit(1);
  }

  const stamped = await prisma.character.updateMany({
    where: { status: "ALIVE", lastActivityTurn: null },
    data: { lastActivityTurn: turn.number },
  });
  console.log(`Stamped lastActivityTurn = ${turn.number} on ${stamped.count} ALIVE character(s).`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
