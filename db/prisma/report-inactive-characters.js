// Read-only report: ALIVE characters who have never registered activity
// (Character.lastActivityTurn) or whose last activity was turn 1 — i.e.
// characters that look like they haven't posted since day one — plus anyone
// who has left the Discord guild (Character.leftGuildAt). Prints only; makes
// no writes. Same lastActivityTurn semantics as db/lib/catatonicPass.js:
// null reads as "active right now," so it is reported separately from a
// character genuinely stuck on turn 1.
//
//   npm run db:report-inactive-characters
require("dotenv").config();
const { prisma } = require("../index");

async function main() {
  const turn =
    (await prisma.turn.findFirst({ where: { status: "OPEN" }, select: { number: true } })) ??
    (await prisma.turn.findFirst({ orderBy: { number: "desc" }, select: { number: true } }));
  if (!turn) {
    console.log("No turns found — nothing to report against.");
    return;
  }

  const characters = await prisma.character.findMany({
    where: { status: "ALIVE" },
    select: { id: true, name: true, discordUserId: true, lastActivityTurn: true, leftGuildAt: true },
  });

  const leftGuild = characters.filter((c) => c.leftGuildAt != null);
  const neverActive = characters.filter((c) => c.leftGuildAt == null && c.lastActivityTurn == null);
  const sinceDayOne = characters
    .filter((c) => c.leftGuildAt == null && c.lastActivityTurn === 1)
    .sort((a, b) => a.name.localeCompare(b.name));

  console.log(`Current/most recent turn: ${turn.number}\n`);

  console.log(`Left the Discord guild (${leftGuild.length}):`);
  for (const c of leftGuild) {
    console.log(`  - ${c.name} (${c.discordUserId}) — left ${c.leftGuildAt.toISOString()}`);
  }

  console.log(`\nNever recorded any activity — clock never stamped (${neverActive.length}):`);
  for (const c of neverActive) {
    console.log(`  - ${c.name} (${c.discordUserId})`);
  }

  console.log(`\nLast active on turn 1 — hasn't posted since day one (${sinceDayOne.length}):`);
  for (const c of sinceDayOne) {
    console.log(`  - ${c.name} (${c.discordUserId}) — idle ${turn.number - 1} turn(s)`);
  }

  console.log(
    "\nThis is a read-only report. Review these characters at /gm/players before taking any action — " +
      "nothing here has been modified or deleted.",
  );
}

main()
  .then(() => prisma.$disconnect())
  .catch((err) => {
    console.error(err);
    prisma.$disconnect();
    process.exit(1);
  });
