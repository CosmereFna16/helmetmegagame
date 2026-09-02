const fs = require("node:fs");
const path = require("node:path");

// Where docs/ actually is at runtime. A plain `path.join(__dirname, ...)`
// breaks under Turbopack, which inlines __dirname as a literal that resolves
// to the wrong tree in the Next server build (only in the WEB container —
// the bot runs unbundled, where __dirname is real). serverExternalPackages
// does NOT fix it: @lifeweb/db is a workspace symlink, so Next treats it as
// first-party source to bundle regardless. So the search below starts from
// somewhere a bundler cannot rewrite: __dirname first (the direct answer
// when real), process.cwd() as the fallback that survives bundling.

const MARKER = "zones.yaml"; // identifies OUR docs/, not some other one
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

module.exports = { docsPath };
