// One pass that both extract.js and reinject.js call, so the two can never
// disagree about what an entry is or what its id means.
//
// Ids are ordinal, not positional: `file#kind:3` is the third string of that
// kind in that file. They survive the user rewriting the words (which is the
// whole point) and they shift only when strings are added or removed around
// them — at which point `old:` no longer matches and reinject reports a
// conflict instead of writing to the wrong place.

const fs = require("fs");
const path = require("path");

const S = require("./sources.js");
const { findScalars, encodeScalar } = require("./yamlScalars.js");
const { extractStrings, encodeString, wordCount } = require("./jsStrings.js");

const ROOT = path.resolve(__dirname, "..", "..");

function repoPath(p) {
  return path.relative(ROOT, p).split(path.sep).join("/");
}

function walkDir(dir, out = []) {
  let items;
  try {
    items = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of items) {
    if (S.IGNORE_DIRS.includes(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walkDir(p, out);
    else if (e.name.endsWith(".js")) out.push(p);
  }
  return out;
}

// --- YAML -------------------------------------------------------------------

// The nearest identifying line above a scalar, so the worksheet can say which
// tag or role it belongs to without the user opening the file.
function yamlLabel(lines, lineNo) {
  const keyCol = /^(\s*)/.exec(lines[lineNo - 1] || "")[1].length;
  for (let i = lineNo - 2; i >= 0; i--) {
    const m = /^(\s*)(?:-\s+)?(slug|key|id|name):\s*(\S.*?)\s*$/.exec(lines[i]);
    if (!m) continue;
    const col = m[1].length;
    if (col > keyCol) continue;
    return m[3].replace(/^["']|["']$/g, "");
  }
  return null;
}

function collectYaml() {
  const out = [];
  for (const src of S.YAML_SOURCES) {
    const abs = path.join(ROOT, src.file);
    if (!fs.existsSync(abs)) continue;
    const text = fs.readFileSync(abs, "utf8");
    const lines = text.split("\n");
    const found = findScalars(text, src.keys);
    const counters = new Map();

    for (const f of found) {
      const ord = (counters.get(f.key) || 0) + 1;
      counters.set(f.key, ord);
      const suffix = f.index === null ? `${ord}` : `${f.occurrence}[${f.index}]`;
      const where =
        typeof src.where === "string" ? src.where : src.where[f.key] || "";
      const label = yamlLabel(lines, f.line);
      out.push({
        id: `${src.file}#${f.key}:${suffix}`,
        file: src.file,
        group: src.group,
        kind: `yaml:${f.key}`,
        label,
        where,
        line: f.line,
        value: f.value,
        words: wordCount(f.value),
        _yaml: f,
      });
    }
  }
  return out;
}

function applyYaml(file, edits) {
  // edits: [{ node, value }] — spliced back-to-front so earlier offsets stay valid.
  const abs = path.join(ROOT, file);
  let text = fs.readFileSync(abs, "utf8");
  const sorted = [...edits].sort((a, b) => b.node.valueStart - a.node.valueStart);
  for (const { node, value } of sorted) {
    const encoded = encodeScalar(value, node.style, node.contentIndent);
    text = text.slice(0, node.valueStart) + encoded + text.slice(node.valueEnd);
  }
  fs.writeFileSync(abs, text);
}

// --- JavaScript -------------------------------------------------------------

function jsFiles() {
  const files = [];
  for (const r of S.JS_ROOTS) {
    const abs = path.join(ROOT, r);
    if (!fs.existsSync(abs)) continue;
    if (fs.statSync(abs).isDirectory()) walkDir(abs, files);
    else files.push(abs);
  }
  return files
    .map(repoPath)
    .filter((f) => !S.IGNORE_FILES.includes(f))
    .sort();
}

// Describes where a string lives, in the terms a writer needs rather than a
// programmer's.
function describeJs(file, entry) {
  const bits = [];
  const route = /^web\/app\/\(app\)\/([^/]+)/.exec(file);
  if (route) bits.push(`/${route[1]}`);
  else if (file === "web/app/page.js") bits.push("the landing page");
  if (entry.context) bits.push(entry.context);

  const k = entry.kind;
  if (k === "jsx-text") bits.push("visible text");
  else if (k.startsWith("prop:")) bits.push(`${k.slice(5)} prop`);
  else if (k === "UserError") bits.push("refusal shown when the action is blocked");
  else if (k.startsWith("reply:")) bits.push("Discord reply");
  else if (k.startsWith("embed:")) bits.push("embed field");
  else if (k.startsWith("call:")) bits.push(`${k.slice(5)}()`);
  else if (k.startsWith("const:")) bits.push(k.slice(6));
  else if (k.startsWith("key:")) bits.push(`${k.slice(4)} field`);

  let text = bits.filter(Boolean).join(" — ");
  if (S.DUAL_SURFACE_FILES.has(file))
    text += " · renders in BOTH Discord and the web panel";
  if (S.GUILLEMET_AUTO_KINDS.has(k))
    text += " · sendDm adds the » prefix itself";
  return text;
}

function collectJs() {
  const out = [];
  const errors = [];
  for (const file of jsFiles()) {
    const code = fs.readFileSync(path.join(ROOT, file), "utf8");
    const { entries, error } = extractStrings(code, file);
    if (error) {
      errors.push({ file, error });
      continue;
    }
    const counters = new Map();
    for (const e of entries) {
      const ord = (counters.get(e.kind) || 0) + 1;
      counters.set(e.kind, ord);
      out.push({
        id: `${file}#${e.kind}:${ord}`,
        file,
        group: S.groupForJs(file, e),
        kind: e.kind,
        label: e.context || null,
        where: describeJs(file, e),
        line: null,
        value: e.value,
        words: wordCount(e.value),
        _js: e,
      });
    }
  }
  return { entries: out, errors };
}

function applyJs(file, edits) {
  const abs = path.join(ROOT, file);
  let code = fs.readFileSync(abs, "utf8");
  const sorted = [...edits].sort((a, b) => b.node.start - a.node.start);
  for (const { node, value } of sorted) {
    const encoded = encodeString(node, value);
    code = code.slice(0, node.start) + encoded + code.slice(node.end);
  }
  fs.writeFileSync(abs, code);
}

function collectAll() {
  const yaml = collectYaml();
  const { entries: js, errors } = collectJs();
  return { entries: [...yaml, ...js], errors };
}

module.exports = { collectAll, collectYaml, collectJs, applyYaml, applyJs, ROOT };
