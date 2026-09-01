// One-off: the "A Reminder on the Economy" broadcast, plus a 25 ⬢ grant to
// the Baron.
//
// This exists as a script rather than as clicks on /gm/players because a
// cloud session can't reach the database (raw-TCP Postgres doesn't survive
// the sandbox's HTTPS proxy — see CLAUDE.md "Cloud session setup" §3), so the
// work had to be written down for a machine that can. Run it once from a
// checkout with direct network access, then delete it or leave it as a
// record; nothing else calls it.
//
//   node db/prisma/economy-reminder.js                    # DRY RUN
//   node db/prisma/economy-reminder.js --apply
//   node db/prisma/economy-reminder.js --apply --actor 262426987979735040
//
// Dry run by default, same posture as db:prune-tags and db:doctor: it prints
// exactly who would be DMed and what the Baron's balance would become,
// without sending or writing anything.
require("dotenv").config();
const { prisma } = require("../index");
const { sendDm } = require("../lib/dm");

// Who gets the message. The Watch's Incarn and Squire are deliberately NOT
// here — the ask named the Captain and the Watchmen.
const ROLE_SLUGS = ["sheriff", "meister", "hand", "headman", "captain", "watchman", "baron"];

const BARON_SLUG = "baron";
const GRANT = 25;

// Falls back to the first id in web/lib/superadmin.js — override with
// --actor <discordUserId> so /gm/audit names the GM who actually ran this.
const DEFAULT_ACTOR = "1507184027919057108";

const MESSAGE = [
  "**A Reminder on the Economy**",
  "",
  "Peasants make an exorbitant amount of Resources. Currently, the Town is very rich, while the Fortress is very poor. Historically, it has been the other way around — and for good reason. A stocked war chest allows the Keep to defend itself and the Town by hiring, training, and equipping watchmen.",
  "",
  "Peasants should be allowed to keep enough food to feed themselves — 1 or 2 ⬢ — and nothing else. If any element of this economic process, whether the Sheriff, the Meister, or the Headman, fails in this, it is the responsibility of the other elements to correct course and reinstate the proper functioning of the economy.",
  "",
  "For the good of Ravenheart.",
  "",
  "-# Sent to several players.",
].join("\n");

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? null : process.argv[i + 1] ?? null;
}

async function main() {
  const apply = process.argv.includes("--apply");
  const actorDiscordUserId = arg("actor") || DEFAULT_ACTOR;

  const recipients = await prisma.character.findMany({
    where: {
      status: "ALIVE",
      discordUserId: { not: null },
      role: { slug: { in: ROLE_SLUGS } },
    },
    select: {
      id: true,
      name: true,
      lastName: true,
      discordUserId: true,
      resources: true,
      role: { select: { slug: true, name: true } },
    },
    orderBy: [{ role: { name: "asc" } }, { name: "asc" }],
  });

  const missing = ROLE_SLUGS.filter((slug) => !recipients.some((c) => c.role?.slug === slug));

  console.log(`${apply ? "APPLY" : "DRY RUN"} — ${recipients.length} recipient(s)\n`);
  for (const c of recipients) {
    console.log(`  ${c.role.name.padEnd(10)} ${[c.name, c.lastName].filter(Boolean).join(" ")}`);
  }
  if (missing.length) console.log(`\n  no living holder: ${missing.join(", ")}`);

  // One seat, so more than one living holder is a data problem the grant
  // must not silently pick a winner for.
  const barons = recipients.filter((c) => c.role?.slug === BARON_SLUG);
  if (barons.length !== 1) {
    console.log(`\n! ${barons.length} living Baron(s) — skipping the ${GRANT} ⬢ grant.`);
  } else {
    const b = barons[0];
    console.log(`\n  Baron ${b.name}: ${b.resources} → ${b.resources + GRANT} ⬢`);
  }

  if (!apply) {
    console.log("\nNothing sent, nothing written. Re-run with --apply.");
    return;
  }

  // The grant first: a failed DM should never leave the ⬢ unsent, and the
  // Baron's own reminder DM below is the same send as everyone else's.
  if (barons.length === 1) {
    const b = barons[0];
    const updated = await prisma.$transaction(async (tx) => {
      const row = await tx.character.update({
        where: { id: b.id },
        data: { resources: { increment: GRANT } },
      });
      await tx.auditLog.create({
        data: {
          actorDiscordUserId,
          actionType: "gm_character_applied",
          targetCharacterId: b.id,
          reason: "Economy reminder — grant to the Baron.",
          details: { core: { resources: { from: b.resources, to: b.resources + GRANT } } },
        },
      });
      return row;
    });
    await sendDm(
      prisma,
      b.discordUserId,
      `Your sheet was edited:\nResources: ${b.resources} → ${updated.resources} ⬢`,
      { authorDiscordUserId: actorDiscordUserId, source: "gm_dev" },
    ).catch((err) => console.error(`  ! grant DM to ${b.name} failed: ${err.message}`));
    console.log(`  granted ${GRANT} ⬢ to ${b.name} (now ${updated.resources} ⬢)`);
  }

  // Sequential, not Promise.all: postDmBatched is a REST call per recipient
  // and a burst of them is exactly what Discord's DM rate limit punishes.
  // One failure is logged and stepped over so the rest still land.
  for (const c of recipients) {
    try {
      await sendDm(prisma, c.discordUserId, MESSAGE, {
        authorDiscordUserId: actorDiscordUserId,
        source: "gm_broadcast",
      });
      console.log(`  sent → ${c.role.name} ${c.name}`);
    } catch (err) {
      console.error(`  ! ${c.role.name} ${c.name}: ${err.message}`);
    }
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
