import fs from "node:fs";
import path from "node:path";

// The running build's identity, for the adjudication desk's version-aware
// poll (Workspace.js + /api/desk-version). Two callers in the same container
// — the page render and the poll endpoint — read this and must agree, which
// is why it's a runtime read and not a build-time inline.
//
// Why this exists at all: this repo deploys on every push to master, often
// several times an hour. When the build under an open desk changes, the next
// RSC fetch trips Next's build-id mismatch check and falls back to a full
// browser navigation (fetch-server-response.js's doMpaNavigation) — the page
// reload that kept yanking the desk out from under GMs. The desk now asks
// this endpoint *first* and refreshes only on a same-version answer.
//
// Source order:
//   1. RAILWAY_GIT_COMMIT_SHA — present when Railway injects it. NOT
//      guaranteed: `railway variables -s web` shows no RAILWAY_GIT_* today,
//      so this is opportunistic, not load-bearing.
//   2. .next/BUILD_ID — always written by `next build`, new value every
//      build, and the web service runs plain `next build`/`next start`. This
//      is the same identity Next's own mismatch check derives from.
//   3. "dev" — the constant answer under `next dev` (checked first), so HMR
//      re-evaluation can never fake a deploy, and the fallback when nothing
//      else resolves.

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
  // cwd is web/ under `npm run start --workspace=web`, but cover being run
  // from the repo root too — a wrong guess here silently degrades to "dev",
  // which just means the desk never flags staleness (today's behaviour).
  for (const dir of [process.cwd(), path.join(process.cwd(), "web")]) {
    try {
      const id = fs.readFileSync(path.join(dir, ".next", "BUILD_ID"), "utf8").trim();
      if (id) return id;
    } catch {
      /* try the next candidate */
    }
  }
  return null;
}
