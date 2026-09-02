// The destructive counterpart to `npm run db:sync-tags`. Run with
// `npm run db:prune-tags` to see what would go, and
// `npm run db:prune-tags -- --apply` to actually delete it. Dry-run-by-default
// with an --apply flag matches db:prune-orphan-roles, the other destructive
// script in this directory.
//
// Deliberately terminal-only, and deliberately NOT wired into wipeGameData's
// "Restart Game" flow: a wipe clears every CharacterTag first, so a prune
// running there would find every GM-created tag unheld and — but for the
// custom flag — delete the lot. Keeping it out of that path keeps the blast
// radius somewhere a human is watching.
require("dotenv").config();
const { prisma } = require("../../index");
const { pruneTagsFromYaml } = require("../../lib/pruneTags");

async function main() {
  const apply = process.argv.includes("--apply");
  const { deletable, skipped, deleted } = await pruneTagsFromYaml(prisma, { apply });

  if (skipped.length) {
    console.log(`Kept ${skipped.length} tag(s) absent from docs/tags.yaml:`);
    for (const { tag, reasons } of skipped) {
      console.log(`  - ${tag.name} (${tag.slug}) — ${reasons.join("; ")}`);
    }
    console.log("");
  }

  if (!deletable.length) {
    console.log("Nothing to prune.");
    return;
  }

  console.log(`${apply ? "Deleted" : "Would delete"} ${deletable.length} unreferenced tag(s):`);
  for (const tag of deletable) console.log(`  - ${tag.name} (${tag.slug})`);

  if (!apply) {
    console.log("\nDry run. Re-run with `-- --apply` to delete them.");
  } else {
    console.log(`\nDeleted ${deleted}.`);
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch((err) => {
    console.error(err);
    prisma.$disconnect();
    process.exit(1);
  });
