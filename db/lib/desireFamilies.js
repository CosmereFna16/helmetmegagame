// Reads ONLY the `families:` header of docs/desires.yaml — never the
// `desires:` list below it, so a caller that just needs to validate a
// family key doesn't pay for parsing the whole catalog.
//
// docs/desires.yaml does not exist yet (a later task, db/lib/syncDesires.js,
// writes both it and the sync that reads the rest of it). A MISSING file is
// NOT an error here: db/lib/syncTags.js requires this module so a tag's
// `desires.locks` families can be checked at db:sync-tags time, and a repo
// with no desires.yaml yet must still be able to sync tags — it just can't
// validate any `desires:` block against real families, so it gets an empty
// set and every reference throws (the same failure a typo would produce).

const fs = require("node:fs");
const yaml = require("js-yaml");
const { docsPath } = require("./repoPaths");

let cached;

// Returns a Set of family keys. Empty when docs/desires.yaml is absent.
function desireFamilyKeys() {
  if (cached !== undefined) return cached;
  cached = new Set();
  const file = docsPath("desires.yaml");
  if (!file || !fs.existsSync(file)) return cached;
  const doc = yaml.load(fs.readFileSync(file, "utf8")) ?? {};
  for (const entry of doc.families ?? []) {
    if (entry?.key) cached.add(entry.key);
  }
  return cached;
}

// Same read, but { key, name } pairs — cheap since the header is tiny and
// already parsed above; kept as a separate export so a caller that only
// wants the Set (the common case, e.g. validation) never carries names it
// doesn't need.
function desireFamilies() {
  const file = docsPath("desires.yaml");
  if (!file || !fs.existsSync(file)) return [];
  const doc = yaml.load(fs.readFileSync(file, "utf8")) ?? {};
  return (doc.families ?? []).filter((f) => f?.key).map((f) => ({ key: f.key, name: f.name ?? f.key }));
}

module.exports = { desireFamilyKeys, desireFamilies };
