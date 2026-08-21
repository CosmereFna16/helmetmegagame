const { execSync } = require("child_process");

try {
  process.chdir("/Users/local-ra33478/lifeweb");

  // Abort the rebase
  try {
    execSync("git rebase --abort", { stdio: "inherit" });
  } catch (e) {
    console.log("No rebase to abort or already aborted");
  }

  // Add all the resolved changes
  execSync("git add -A", { stdio: "inherit" });

  // Create a merge commit
  execSync("git commit -m \"Merge remote main: add default moves + expiry grants\nCo-Authored-By: Claude Haiku 4.5 <noreply@anthropic.com>\"", { stdio: "inherit" });

  // Push to origin
  execSync("git push origin master", { stdio: "inherit" });

  console.log("\nPushed! Now deploying...");

  // Deploy
  execSync("npm run deploy", { stdio: "inherit" });

} catch (e) {
  console.error("Error:", e.message);
  process.exit(1);
}
