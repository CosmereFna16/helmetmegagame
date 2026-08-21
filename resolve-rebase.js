const { execSync } = require("child_process");
const path = require("path");

try {
  process.chdir("/Users/local-ra33478/lifeweb");
  console.log("Adding conflicted files...");
  execSync("git add db/index.js CLAUDE.md db/prisma/schema.prisma docs/tags.yaml", { stdio: "inherit" });
  console.log("Continuing rebase...");
  execSync("git rebase --continue", { stdio: "inherit" });
  console.log("Rebase complete!");
} catch (e) {
  console.error("Error:", e.message);
  process.exit(1);
}
