// Read-only: which craftable items has the catalog gained that the player-facing
// recipe documents never mention?
//
// docs/documents.yaml carries the Smithing, Brewing and Cooking papers as
// hand-written lists. Nothing generates them from docs/tags.yaml, so a tag added
// to the catalog is invisible to players until somebody writes it in.
//
// Run it after adding any craftable (`npm run db:audit-craft-docs`). Touches no
// database and writes nothing; exits 1 when something is unlisted.
const fs = require("node:fs");
const yaml = require("js-yaml");
const { docsPath } = require("../../lib/repoPaths");
const { entriesOf } = require("../../lib/yamlEntries");

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
  const tags = load("tags.yaml").tags ?? {};
  const documents = load("documents.yaml").documents ?? {};

  let missing = 0;
  for (const { doc, groups } of OWNERS) {
    const body = documents[doc]?.description ?? "";
    if (!body) {
      console.log(`! docs/documents.yaml has no "${doc}" document — skipping`);
      continue;
    }
    // Narrower than the real token grammar, which web/app/components/richTokens.js
    // owns (TOKEN_SOURCE). Kept local because that module is ESM under web/ and
    // this is CJS under db/; a token it misses reads as unlisted, never as listed.
    const listed = new Set([...body.matchAll(/\{tag:([a-z0-9-]+)\}/g)].map((m) => m[1]));

    const gaps = entriesOf(tags, "slug")
      .filter((t) => t.craftable && groups.includes(t.group))
      .filter((t) => !listed.has(t.slug))
      .map((t) => ({
        slug: t.slug,
        cost: t.requirement?.resourceCost ?? 0,
        turns: t.requirement?.turnsCost ?? 0,
        skills: (t.requirement?.skills ?? []).join(" + ") || "(no skill)",
      }))
      .sort((a, b) => a.cost - b.cost || a.slug.localeCompare(b.slug));

    missing += gaps.length;
    if (!gaps.length) {
      console.log(`✓ ${doc}: every craftable is listed`);
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
