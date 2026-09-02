// The channel doctor from a terminal. DRY RUN by default; pass `-- --apply`
// to repair, `-- --full` for the expensive scope (overwrites, threads,
// narrowcast) on top of the cheap role-membership checks.
//
//   npm run db:doctor                  # cheap checks, report only
//   npm run db:doctor -- --full        # everything, report only
//   npm run db:doctor -- --apply       # cheap checks, repaired
//   npm run db:doctor -- --full --apply
require("dotenv").config();
const { prisma } = require("../../index");
const { runChannelDoctor } = require("../../lib/channelDoctor");

async function main() {
  if (!process.env.DISCORD_TOKEN || !process.env.DISCORD_GUILD_ID) {
    console.error("DISCORD_GUILD_ID and DISCORD_TOKEN must be set.");
    process.exit(1);
  }
  const apply = process.argv.includes("--apply");
  const scope = process.argv.includes("--full") ? "full" : "cheap";

  const result = await runChannelDoctor(prisma, { apply, scope });

  if (result.findings.length === 0) {
    console.log(`doctor (${scope}): everything matches — nothing to do.`);
    return;
  }
  console.log(`doctor (${scope}${apply ? ", applied" : ", dry run"}): ${result.findings.length} finding(s)`);
  for (const f of result.findings) {
    const status = f.repaired ? "repaired" : f.error ? `REPAIR FAILED: ${f.error}` : apply ? "not repairable here" : "would repair";
    console.log(`  - [${f.check}] ${f.target}: ${f.problem} (${status})`);
  }
  if (!apply) console.log("Re-run with -- --apply to repair.");
}

main()
  .then(() => prisma.$disconnect())
  .catch((err) => {
    console.error(err);
    prisma.$disconnect();
    process.exit(1);
  });
