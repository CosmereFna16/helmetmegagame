import fs from "node:fs";
import path from "node:path";

// The running build's identity, used by the adjudication desk's
// version-aware poll (Workspace.js + /api/desk-version) to avoid tripping
// Next's build-id mismatch check mid-session. Read at runtime so page render
// and the poll endpoint agree. Order: RAILWAY_GIT_COMMIT_SHA, then
// .next/BUILD_ID, then "dev".

let cached = null;

export function deployVersion() {
  if (process.env.NODE_ENV !== "production") return "dev";
  if (cached) return cached;
  cached =
    process.env.RAILWAY_GIT_COMMIT_SHA ??
    readBuildId() ??
    "dev";
  return cached;
}

function readBuildId() {
  // cwd may be web/ or the repo root; a wrong guess silently degrades to "dev".
  for (const dir of [process.cwd(), path.join(process.cwd(), "web")]) {
    try {
      const id = fs.readFileSync(path.join(dir, ".next", "BUILD_ID"), "utf8").trim();
      if (id) return id;
    } catch {
    }
  }
  return null;
}
