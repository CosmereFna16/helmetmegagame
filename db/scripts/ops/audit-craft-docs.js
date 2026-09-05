// Read-only: which craftable items has the catalog gained that the player-facing
// recipe documents never mention?
//
// docs/documents.yaml carries the Smithing, Brewing and Cooking papers as
// hand-written lists. Nothing generates them from docs/tags.yaml, so a tag added
// to the catalog is invisible to players until somebody remembers to write it in
// — which is exactly how two helmets sat uncraftable-in-practice for weeks.
//
// Run it after adding any craftable. Touches no database and writes nothing.
//
//   node db/scripts/ops/audit-craft-docs.js
//
// Exits 1 when something is unlisted, so it can gate a push if that is ever
// wanted. `--quiet` prints only the misses.
const fs = require("node:fs");
const yaml = require("js-yaml");
const { docsPath } = require("../../lib/repoPaths");

// Which document is answerable for which tag groups. A craftable outside these
// groups (a structure, a tonic effect) is nobody's recipe list and is skipped.
const OWNERS = [
  { doc: "smithing", groups: ["items-weapons", "items-armor", "items-headgear", "items-gear"] },
  { doc: "alcoholdrugs", groups: ["items-drink"] },
  { doc: "meals", groups: ["items-food"] },
];

function load(name) {
  const p = docsPath(name);
  if (!p) throw new Error(`Cannot find docs/${name} — see db/lib/repoPaths.js`);
  return yaml.load(fs.readFileSync(p, "utf8"));
}

function main() {
  const quiet = process.argv.includes("--quiet");
  const tags = load("tags.yaml").tags ?? {};
  const documents = load("documents.yaml").documents ?? {};

  let missing = 0;
  for (const { doc, groups } of OWNERS) {
    const body = documents[doc]?.description ?? "";
    if (!body) {
      console.log(`! docs/documents.yaml has no "${doc}" document — skipping`);
      continue;
    }
    const listed = new Set([...body.matchAll(/\{tag:([a-z0-9-]+)\}/g)].map((m) => m[1]));

    const gaps = Object.entries(tags)
      .filter(([, t]) => t.craftable && groups.includes(t.group))
      .filter(([slug]) => !listed.has(slug))
      .map(([slug, t]) => ({
        slug,
        cost: t.requirement?.resourceCost ?? 0,
        turns: t.requirement?.turnsCost ?? 0,
        skills: (t.requirement?.skills ?? []).join(" + ") || "(no skill)",
      }))
      .sort((a, b) => a.cost - b.cost || a.slug.localeCompare(b.slug));

    missing += gaps.length;
    if (!gaps.length) {
      if (!quiet) console.log(`✓ ${doc}: every craftable is listed`);
      continue;
    }
    console.log(`\n${doc} — ${gaps.length} craftable(s) not mentioned:`);
    for (const g of gaps) {
      console.log(`  ${String(g.cost).padStart(3)} ⬢  ${g.turns}t  ${g.slug.padEnd(22)} ${g.skills}`);
    }
  }

  if (missing) {
    console.log(`\n${missing} unlisted craftable(s). Add them to docs/documents.yaml.`);
    process.exitCode = 1;
  }
}

main();
