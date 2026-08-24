#!/usr/bin/env node
// Writes the text drafted in worksheets/ back into source.
//
//   npm run copy:reinject              dry run — says what would change
//   npm run copy:reinject -- --apply   actually write
//   npm run copy:reinject -- --apply bot   only worksheets matching "bot"
//
// Dry-run-unless---apply matches npm run db:prune-tags, the other destructive
// script in this repo.
//
// Safety: every entry is re-located by re-running the extractor, never by a
// stored byte offset, and the string found there must still match the `old:`
// the worksheet was generated from. If it doesn't, the source moved under the
// draft and the entry is reported as a conflict rather than written.

const fs = require("fs");
const path = require("path");
const yaml = require("js-yaml");

const { collectAll, applyYaml, applyJs, ROOT } = require("./collect.js");
const { checkEntry } = require("./guards.js");

const OUT_DIR = path.join(ROOT, "worksheets");

function loadWorksheets(filter) {
  if (!fs.existsSync(OUT_DIR)) {
    console.error("\n  No worksheets/ directory. Run: npm run copy:extract\n");
    process.exit(1);
  }
  const rows = [];
  for (const name of fs.readdirSync(OUT_DIR).sort()) {
    if (!name.endsWith(".yaml") || name.startsWith("_")) continue;
    const group = name.replace(/\.yaml$/, "");
    if (filter.length && !filter.some((f) => group.includes(f))) continue;
    let doc;
    try {
      doc = yaml.load(fs.readFileSync(path.join(OUT_DIR, name), "utf8"));
    } catch (err) {
      console.error(`\n  ${name} is not valid YAML:\n  ${err.message}\n`);
      process.exit(1);
    }
    if (!Array.isArray(doc)) continue;
    for (const row of doc) {
      if (!row || !row.id) continue;
      const next = typeof row.new === "string" ? row.new : "";
      if (next.trim() === "") continue;
      rows.push({ group, id: row.id, old: row.old ?? "", next });
    }
  }
  return rows;
}

function main() {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const filter = args.filter((a) => !a.startsWith("-"));

  const drafts = loadWorksheets(filter);
  if (!drafts.length) {
    console.log("\n  Nothing drafted yet — every 'new:' field is empty.\n");
    return;
  }

  const { entries } = collectAll();
  const byId = new Map(entries.map((e) => [e.id, e]));

  const planned = [];
  const unchanged = [];
  const conflicts = [];
  const warnings = [];
  const blocking = [];

  for (const d of drafts) {
    const entry = byId.get(d.id);
    if (!entry) {
      conflicts.push({ ...d, why: "no longer exists in source" });
      continue;
    }
    if (entry.value !== d.old) {
      conflicts.push({
        ...d,
        why: "source text changed since this worksheet was generated",
        found: entry.value,
      });
      continue;
    }
    if (entry.value === d.next) {
      unchanged.push(d);
      continue;
    }
    const issues = checkEntry(entry, entry.value, d.next);
    for (const i of issues) {
      const rec = { id: d.id, file: entry.file, message: i.message };
      if (i.level === "error") blocking.push(rec);
      else warnings.push(rec);
    }
    planned.push({ entry, next: d.next });
  }

  // --- report ---------------------------------------------------------------
  console.log("");
  const byFile = new Map();
  for (const p of planned) {
    if (!byFile.has(p.entry.file)) byFile.set(p.entry.file, []);
    byFile.get(p.entry.file).push(p);
  }

  if (planned.length) {
    console.log(`  ${planned.length} string(s) to rewrite across ${byFile.size} file(s):`);
    for (const [file, list] of byFile) {
      console.log(`    ${file}  (${list.length})`);
    }
    console.log("");
  }

  if (warnings.length) {
    console.log(`  ${warnings.length} warning(s):`);
    for (const w of warnings) console.log(`    ${w.id}\n      ${w.message}`);
    console.log("");
  }

  if (conflicts.length) {
    console.log(`  ${conflicts.length} conflict(s) — skipped, nothing written for these:`);
    for (const c of conflicts) {
      console.log(`    ${c.id}\n      ${c.why}`);
      if (c.found !== undefined) {
        console.log(`      worksheet had: ${JSON.stringify(c.old).slice(0, 72)}`);
        console.log(`      source has:    ${JSON.stringify(c.found).slice(0, 72)}`);
      }
    }
    console.log(
      `\n  Re-run 'npm run copy:extract' to refresh them — your drafts are kept.\n`,
    );
  }

  if (unchanged.length) {
    console.log(`  ${unchanged.length} draft(s) identical to the current text — nothing to do.\n`);
  }

  if (blocking.length) {
    console.log(`  ${blocking.length} BLOCKING problem(s) — nothing was written:`);
    for (const b of blocking) console.log(`    ${b.id}\n      ${b.message}`);
    console.log(
      "\n  Discord rejects these outright. Because commands are registered with a\n" +
        "  single full-replace call, one over-long string takes out every command.\n",
    );
    process.exit(1);
  }

  if (!planned.length) return;

  if (!apply) {
    console.log("  Dry run. Re-run with --apply to write:\n");
    console.log("    npm run copy:reinject -- --apply\n");
    return;
  }

  // --- write ----------------------------------------------------------------
  for (const [file, list] of byFile) {
    const yamlEdits = list.filter((p) => p.entry._yaml);
    const jsEdits = list.filter((p) => p.entry._js);
    if (yamlEdits.length)
      applyYaml(
        file,
        yamlEdits.map((p) => ({ node: p.entry._yaml, value: p.next })),
      );
    if (jsEdits.length)
      applyJs(
        file,
        jsEdits.map((p) => ({ node: p.entry._js, value: p.next })),
      );
  }

  console.log(`  Wrote ${planned.length} string(s) to ${byFile.size} file(s).\n`);

  const touchedYaml = [...byFile.keys()].filter((f) => f.endsWith(".yaml"));
  if (touchedYaml.length) {
    console.log("  YAML masters changed — sync them, in this order:\n");
    const order = [
      ["docs/locations.yaml", "npm run db:sync-locations"],
      ["docs/tags.yaml", "npm run db:sync-tags"],
      ["docs/taggroups.yaml", "npm run db:sync-tags"],
      ["docs/roles.yaml", "npm run db:sync-roles"],
      ["docs/documents.yaml", "npm run db:sync-documents"],
      ["docs/systemdocs/infochannel.yaml", "npm run db:rebuild-info-channel"],
    ];
    const cmds = [];
    for (const [f, cmd] of order)
      if (touchedYaml.includes(f) && !cmds.includes(cmd)) cmds.push(cmd);
    for (const c of cmds) console.log(`    ${c}`);
    console.log(
      "\n  These need direct network access to the database — a sandboxed session\n" +
        "  gets P1001 against Railway's TCP proxy.\n",
    );
  }
  console.log("  Then review the diff:  git diff\n");
}

main();
