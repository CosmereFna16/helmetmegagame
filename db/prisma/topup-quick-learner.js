// One-off: pays the retired Quick Learner's holders the 2 points they are
// still owed.
//
// db/prisma/retire-quick-learner.js refunded 3 points — 60% of the tag's
// 5-point price. The call since is that a retirement should pay the full
// price back, so every holder is 2 points short.
//
// The holder list is hard-coded below rather than queried, because there is
// nothing left to query: the retire script deleted the CharacterTag rows AND
// the Tag row inside one transaction. These 13 names come from that run's
// console output, and each was confirmed to resolve to exactly one living
// character before this script was written.
//
//   node db/prisma/topup-quick-learner.js                    # DRY RUN
//   node db/prisma/topup-quick-learner.js --apply
//   node db/prisma/topup-quick-learner.js --apply --actor 262426987979735040
//
// Dry run by default, same posture as db:prune-tags and db:doctor.
//
// Safe to re-run. Balances move as players spend, so a "does the number look
// topped up?" check would be wrong — the guard is the AuditLog row this
// script writes, matched on target character + the exact REASON string below.
require("dotenv").config();
const { prisma } = require("../index");
const { sendDm } = require("../lib/dm");

const TOPUP = 2; // 5 (the tag's price) minus the 3 already refunded.

// Flat, to every holder — including the one who was granted the tag by an
// EVENT rather than buying it. Same posture the original refund took.
const NAMES = [
  "Lucas Galeheart",
  "Arthur Feld",
  "Milan Kowalski",
  "Valerio Martis",
  "Julius Floobenhaven",
  "Doctor Elspeth",
  "Jenny Laurence",
  "Master Asael Lavendar",
  "Mikhail Serviskiy",
  "Everard d'Aubrecourt",
  "Elaine Sybil",
  "Constable Tornagh",
  "Tarcil Rayer",
];

// Doubles as the idempotency key. Do not reword it without also clearing the
// rows it already wrote.
const REASON = "Quick Learner refund correction — the full 5 points, not 3.";

const MESSAGE = [
  "Quick Learner was retired, and you were refunded 3 points for it. That was short — the tag cost 5, and you should have had all 5 back.",
  "",
  "The missing 2 points are on your sheet now. Spend them at /store.",
].join("\n");

// Falls back to the first id in web/lib/superadmin.js — override with
// --actor <discordUserId> so /gm/audit names the GM who actually ran this.
const DEFAULT_ACTOR = "1507184027919057108";

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? null : process.argv[i + 1] ?? null;
}

async function main() {
  const apply = process.argv.includes("--apply");
  const actorDiscordUserId = arg("actor") || DEFAULT_ACTOR;

  // Resolve every name first, and refuse to pay anyone if a single one is
  // ambiguous or missing — a wrong match here quietly pays the wrong player.
  const resolved = [];
  const problems = [];
  for (const name of NAMES) {
    const rows = await prisma.character.findMany({
      where: { name },
      select: { id: true, name: true, tagPoints: true, status: true, discordUserId: true },
    });
    if (rows.length !== 1) {
      problems.push(`${name}: ${rows.length} matches`);
      continue;
    }
    resolved.push(rows[0]);
  }

  if (problems.length) {
    console.error("Refusing to run — these names did not resolve to one character each:");
    for (const p of problems) console.error(`  ${p}`);
    process.exitCode = 1;
    return;
  }

  const paidIds = new Set(
    (
      await prisma.auditLog.findMany({
        where: { reason: REASON, targetCharacterId: { in: resolved.map((c) => c.id) } },
        select: { targetCharacterId: true },
      })
    ).map((r) => r.targetCharacterId),
  );

  const todo = resolved.filter((c) => !paidIds.has(c.id));

  for (const c of resolved) {
    if (paidIds.has(c.id)) {
      console.log(`  ${c.name}: already paid, skipping (${c.tagPoints} points)`);
    } else {
      const dm = c.discordUserId ? "" : "  [no Discord user — no DM]";
      console.log(`  ${c.name}: ${c.tagPoints} -> ${c.tagPoints + TOPUP}${dm}`);
    }
  }

  if (!todo.length) {
    console.log("\nEverybody is already paid. Nothing to do.");
    return;
  }

  if (!apply) {
    console.log(`\n${todo.length} to pay, ${TOPUP} point(s) each. Nothing written. Re-run with --apply.`);
    return;
  }

  // The grant commits before the DM, so a Discord failure can never leave a
  // player unpaid. Sequential, not Promise.all: postDmBatched is a REST call
  // per recipient and a burst is exactly what the DM rate limit punishes.
  let paid = 0;
  for (const c of todo) {
    const updated = await prisma.$transaction(async (tx) => {
      const row = await tx.character.update({
        where: { id: c.id },
        data: { tagPoints: { increment: TOPUP } },
      });
      await tx.auditLog.create({
        data: {
          actorDiscordUserId,
          actionType: "gm_character_applied",
          targetCharacterId: c.id,
          reason: REASON,
          details: { core: { tagPoints: { from: c.tagPoints, to: c.tagPoints + TOPUP } } },
        },
      });
      return row;
    });
    paid += 1;
    console.log(`  paid ${c.name}: ${c.tagPoints} -> ${updated.tagPoints}`);

    if (!c.discordUserId) {
      console.log(`  ! ${c.name} has no Discord user — paid, but not told`);
      continue;
    }
    await sendDm(prisma, c.discordUserId, MESSAGE, {
      authorDiscordUserId: actorDiscordUserId,
      source: "gm_broadcast",
    }).catch((err) => console.error(`  ! DM to ${c.name} failed: ${err.message}`));
  }

  console.log(`\nPaid ${TOPUP} point(s) to ${paid} holder(s).`);
}

main()
  .then(() => prisma.$disconnect())
  .catch((err) => {
    console.error(err);
    prisma.$disconnect();
    process.exit(1);
  });
