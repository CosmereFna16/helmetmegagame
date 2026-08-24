#!/usr/bin/env node
// Pulls every player-facing string into worksheets under worksheets/.
//
//   npm run copy:extract            regenerate all worksheets
//   npm run copy:extract -- web     only worksheets whose name contains "web"
//
// Re-running is safe: anything already written into a `new:` field is carried
// forward. New strings are appended; strings that no longer exist in source
// are dropped, and any drafted text they carried is reported rather than
// silently discarded.

const fs = require("fs");
const path = require("path");
const yaml = require("js-yaml");

const { collectAll, ROOT } = require("./collect.js");
const { GROUP_TITLES, GROUP_ORDER, YAML_SOURCES } = require("./sources.js");

// The docs/*.yaml masters are prose already, in files that are pleasant to
// edit directly — so they are not worksheeted by default. `--content` brings
// them back if that ever changes.
const CONTENT_GROUPS = new Set(YAML_SOURCES.map((s) => s.group));

const OUT_DIR = path.join(ROOT, "worksheets");

const HEADER = `# ------------------------------------------------------------------
# Write your text into the \`new:\` field. Leave it empty to keep what's
# there. Don't touch \`id:\` or \`old:\` — reinject uses them to find the
# string again and to check nobody moved it underneath you.
#
#   npm run copy:reinject              show what would change
#   npm run copy:reinject -- --apply   write it back
#
# Regenerating this file keeps everything you've already written.
# ------------------------------------------------------------------`;

function scalar(value) {
  if (value === "") return '""';
  // A value whose first line is indented can't use a bare block scalar.
  if (/^\s/.test(value) || /\s$/.test(value.split("\n")[0])) {
    return JSON.stringify(value);
  }
  const body = value
    .split("\n")
    .map((l) => (l === "" ? "" : "    " + l))
    .join("\n");
  return "|-\n" + body;
}

function inline(value) {
  return JSON.stringify(value == null ? "" : String(value));
}

function readExisting(file) {
  if (!fs.existsSync(file)) return new Map();
  let doc;
  try {
    doc = yaml.load(fs.readFileSync(file, "utf8"));
  } catch (err) {
    console.error(`\n  ${path.basename(file)} is not valid YAML, so its drafts`);
    console.error(`  can't be carried forward. Fix it and re-run.\n  ${err.message}\n`);
    process.exit(1);
  }
  const map = new Map();
  if (Array.isArray(doc)) {
    for (const row of doc) {
      if (row && row.id && typeof row.new === "string" && row.new.trim() !== "") {
        map.set(row.id, row.new);
      }
    }
  }
  return map;
}

function writeWorksheet(group, entries, drafts) {
  const file = path.join(OUT_DIR, `${group}.yaml`);
  const words = entries.reduce((s, e) => s + e.words, 0);
  const lines = [
    `# ${GROUP_TITLES[group] || group}`,
    `# ${entries.length} entries, ~${words.toLocaleString()} words.`,
    HEADER,
    "",
  ];

  let lastFile = null;
  for (const e of entries) {
    if (e.file !== lastFile) {
      lines.push(`# ${"─".repeat(66)}`, `# ${e.file}`, `# ${"─".repeat(66)}`);
      lastFile = e.file;
    }
    lines.push(`- id: ${inline(e.id)}`);
    if (e.label) lines.push(`  what: ${inline(e.label)}`);
    if (e.where) lines.push(`  where: ${inline(e.where)}`);
    lines.push(`  old: ${scalar(e.value)}`);
    const draft = drafts.get(e.id);
    lines.push(`  new: ${draft ? scalar(draft) : "|-"}`);
    lines.push("");
  }

  fs.writeFileSync(file, lines.join("\n"));
  return { file, count: entries.length, words, drafted: entries.filter((e) => drafts.has(e.id)).length };
}

function main() {
  const args = process.argv.slice(2);
  const filter = args.filter((a) => !a.startsWith("-"));
  const withContent = args.includes("--content");

  const { entries, errors } = collectAll();
  for (const { file, error } of errors) {
    console.error(`  could not parse ${file}: ${error}`);
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });

  const groups = new Map();
  for (const e of entries) {
    if (!groups.has(e.group)) groups.set(e.group, []);
    groups.get(e.group).push(e);
  }

  const ordered = [...groups.keys()].sort((a, b) => {
    const ia = GROUP_ORDER.indexOf(a);
    const ib = GROUP_ORDER.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });

  const liveIds = new Set(entries.map((e) => e.id));
  const orphaned = [];
  const results = [];

  for (const group of ordered) {
    if (!withContent && CONTENT_GROUPS.has(group)) continue;
    if (filter.length && !filter.some((f) => group.includes(f))) continue;
    const file = path.join(OUT_DIR, `${group}.yaml`);
    const drafts = readExisting(file);
    for (const [id, text] of drafts) {
      if (!liveIds.has(id)) orphaned.push({ group, id, text });
    }
    results.push({ group, ...writeWorksheet(group, groups.get(group), drafts) });
  }

  const pad = Math.max(...results.map((r) => r.group.length));
  console.log("");
  for (const r of results) {
    const drafted = r.drafted ? `  ${r.drafted} drafted` : "";
    console.log(
      `  ${r.group.padEnd(pad)}  ${String(r.count).padStart(4)} entries  ${String(
        r.words,
      ).padStart(6)} words${drafted}`,
    );
  }
  const total = results.reduce((s, r) => s + r.count, 0);
  const totalWords = results.reduce((s, r) => s + r.words, 0);
  console.log(
    `  ${"".padEnd(pad)}  ${String(total).padStart(4)} entries  ${String(totalWords).padStart(6)} words\n`,
  );
  console.log(`  worksheets/  —  write into the 'new:' fields, then: npm run copy:reinject\n`);
  if (!withContent) {
    console.log(
      `  The docs/*.yaml masters are edited directly, not here. 'npm run copy:extract -- --content'\n` +
        `  worksheets them too, if you ever want that.\n`,
    );
  }

  if (orphaned.length) {
    console.log(`  ${orphaned.length} draft(s) no longer match anything in source:`);
    for (const o of orphaned.slice(0, 10)) {
      console.log(`    ${o.id}\n      ${o.text.slice(0, 70)}`);
    }
    console.log(
      `\n  Their source string was edited or removed since you drafted them.`,
    );
    console.log(`  They are preserved in worksheets/_orphaned.yaml.\n`);
    fs.writeFileSync(
      path.join(OUT_DIR, "_orphaned.yaml"),
      orphaned
        .map((o) => `- id: ${inline(o.id)}\n  group: ${inline(o.group)}\n  new: ${scalar(o.text)}\n`)
        .join("\n"),
    );
  }
}

main();
