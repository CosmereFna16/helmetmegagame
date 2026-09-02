// Reads ONLY the `families:` / `familyGroups:` headers of docs/desires.yaml —
// never the `desires:` list below them, so a caller that just needs to
// validate a family key doesn't pay for parsing the whole catalog.
//
// A MISSING file is NOT an error here: db/lib/syncTags.js requires this
// module so a tag's `desires.locks` families can be checked at db:sync-tags
// time, and a repo with no desires.yaml must still be able to sync tags — it
// just can't validate any `desires:` block against real families, so it gets
// an empty set and every reference throws (the same failure a typo would
// produce).

const fs = require("node:fs");
const yaml = require("js-yaml");
const { docsPath } = require("./repoPaths");

let cachedDoc;

// The parsed file, or {} when absent. Cached for the life of the process —
// this module never invalidates at runtime, same posture as before.
function loadDoc() {
  if (cachedDoc !== undefined) return cachedDoc;
  const file = docsPath("desires.yaml");
  if (!file || !fs.existsSync(file)) return (cachedDoc = {});
  cachedDoc = yaml.load(fs.readFileSync(file, "utf8")) ?? {};
  return cachedDoc;
}

let cachedKeys;
let cachedFamilies;
let cachedGroups;

// Returns a Set of family keys. Empty when docs/desires.yaml is absent.
function desireFamilyKeys() {
  if (cachedKeys !== undefined) return cachedKeys;
  cachedKeys = new Set();
  for (const entry of loadDoc().families ?? []) {
    if (entry?.key) cachedKeys.add(entry.key);
  }
  return cachedKeys;
}

// { key, name, group, color } per family, in header order. `group` names a
// familyGroups entry and `color` is a freeform hex — both are picker-only
// data (web/app/components/DesireCatalog.js) the sync never reads, so either
// may be absent and comes back null. Kept as a separate export so a caller
// that only wants the Set (the common case, validation) never carries names.
function desireFamilies() {
  if (cachedFamilies !== undefined) return cachedFamilies;
  cachedFamilies = (loadDoc().families ?? [])
    .filter((f) => f?.key)
    .map((f) => ({
      key: f.key,
      name: f.name ?? f.key,
      group: f.group ?? null,
      color: f.color ?? null,
    }));
  return cachedFamilies;
}

// { key, name } per familyGroups entry, in header order — the hue clusters
// the picker's tab bar is built from.
function desireFamilyGroups() {
  if (cachedGroups !== undefined) return cachedGroups;
  cachedGroups = (loadDoc().familyGroups ?? [])
    .filter((g) => g?.key)
    .map((g) => ({ key: g.key, name: g.name ?? g.key }));
  return cachedGroups;
}

module.exports = { desireFamilyKeys, desireFamilies, desireFamilyGroups };
