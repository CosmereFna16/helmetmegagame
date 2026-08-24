const fs = require("node:fs");
const path = require("node:path");

// Where docs/ actually is at runtime.
//
// This used to be `path.join(__dirname, "..", "..", "docs", ...)` written out
// at each of six call sites, and that is broken under a bundler: Turbopack
// INLINES __dirname as a literal string when it bundles a module. In the Next
// server build db/lib's became "/ROOT/db/lib" — /ROOT is Turbopack's
// project-root placeholder and is never remapped — so every docs/ read
// resolved to /ROOT/docs/..., which does not exist.
//
// It failed silently and differently depending on the caller: the #turns
// weather banner does fs.existsSync and treats absence as "no banner today",
// so the image just stopped appearing; the four YAML re-syncs threw ENOENT
// into a .catch() at their call site, so Restart Game reported success having
// reprovisioned nothing. And it only ever affected the WEB container — the bot
// runs unbundled, where __dirname is real, which is why the same turn advance
// behaved differently depending on whether the cron or the Dev Panel ran it.
//
// serverExternalPackages does NOT fix this, though it looks like it should:
// @lifeweb/db is a workspace symlink, so Next resolves it to a real path
// outside node_modules and treats it as first-party source to bundle rather
// than as an external package. Verified by setting it, rebuilding, and finding
// all six literals still in the output.
//
// So the search starts from somewhere a bundler cannot rewrite. __dirname is
// still tried first because when it IS real — the bot, and every CLI script in
// db/prisma — it is the most direct answer and cannot pick up the wrong tree.
// process.cwd() is the fallback that survives bundling.

const MARKER = "locations.yaml"; // identifies OUR docs/, not some other one
const MAX_UP = 6;

let cached;

function search(start) {
  let dir = path.resolve(start);
  for (let i = 0; i < MAX_UP; i++) {
    const candidate = path.join(dir, "docs");
    if (fs.existsSync(path.join(candidate, MARKER))) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function docsDir() {
  if (cached !== undefined) return cached;
  cached = search(__dirname) ?? search(process.cwd()) ?? null;
  if (!cached) {
    console.error(
      `Could not locate docs/ (looked for docs/${MARKER} above ${__dirname} and ${process.cwd()})`,
    );
  }
  return cached;
}

// Joins onto docs/, or returns null when docs/ cannot be found at all. Callers
// that read a YAML master should throw on null — a sync with no master is not
// a sync. The weather banner treats null as "no banner", which is the same
// thing it already did for a missing file.
function docsPath(...segments) {
  const dir = docsDir();
  return dir ? path.join(dir, ...segments) : null;
}

module.exports = { docsPath, docsDir };
