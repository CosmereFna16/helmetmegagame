// Locates prose scalars in a YAML file by byte offset, so they can be spliced
// back one at a time.
//
// Why not js-yaml: the masters carry long authoring comment blocks that are
// the real documentation for those files, and a parse/serialize round-trip
// destroys every one of them. This scanner never rewrites the document — it
// hands back byte ranges, and reinject.js splices into them.
//
// It handles the four scalar styles the masters actually use: folded (`>-`),
// literal (`|-`), double-quoted, and plain — plus sequences of those.

const BLOCK_RE = /^([>|])([+-]?)(\d*)([+-]?)\s*$/;
const KEY_RE = /^(\s*)(-\s+)?([A-Za-z_][\w-]*):(\s*)(.*)$/;

function lineOffsets(text) {
  const lines = text.split("\n");
  const offsets = [];
  let at = 0;
  for (const line of lines) {
    offsets.push(at);
    at += line.length + 1;
  }
  return { lines, offsets };
}

function isBlank(line) {
  return /^\s*$/.test(line);
}

function isComment(line) {
  return /^\s*#/.test(line);
}

function indentOf(line) {
  return /^(\s*)/.exec(line)[1].length;
}

// --- decoding ---------------------------------------------------------------

function decodeBlock(bodyLines, contentIndent, style) {
  const stripped = bodyLines.map((l) =>
    isBlank(l) ? "" : l.slice(Math.min(contentIndent, indentOf(l))),
  );
  while (stripped.length && stripped[stripped.length - 1] === "") stripped.pop();
  if (style === "|") return stripped.join("\n");
  // Folded: blank lines become hard newlines, adjacent lines join with a space.
  const out = [];
  let buf = [];
  for (const l of stripped) {
    if (l === "") {
      out.push(buf.join(" "));
      buf = [];
    } else {
      buf.push(l);
    }
  }
  out.push(buf.join(" "));
  return out.join("\n");
}

function decodeDouble(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return raw.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  }
}

function decodeSingle(raw) {
  return raw.slice(1, -1).replace(/''/g, "'");
}

// --- encoding ---------------------------------------------------------------
// Re-emits a value in the SAME style it was found in, so a reinjected file
// diffs only on the words that changed.

function encodeScalar(value, style, contentIndent) {
  const pad = " ".repeat(contentIndent);
  if (style === "|" || style === ">") {
    // One physical line per logical line. docs/roles.yaml's header explains
    // why this is mandatory for `description[]`: a newline inside an element
    // breaks the Markdown bullet, and syncRoles throws mid-pass.
    return value
      .split("\n")
      .map((l) => (l === "" ? "" : pad + l))
      .join("\n");
  }
  if (style === "double") return JSON.stringify(value);
  if (style === "single") return `'${value.replace(/'/g, "''")}'`;
  return value;
}

// --- scanning ---------------------------------------------------------------

// Reads the value that starts at `rest` on line `i`. Returns a descriptor plus
// the index of the first line after the value.
function readValue(ctx, i, rest, keyCol) {
  const { lines, offsets } = ctx;
  const restCol = lines[i].length - rest.length;

  const block = BLOCK_RE.exec(rest);
  if (block) {
    const style = block[1];
    const chomp = block[2] || block[4] || "";
    let j = i + 1;
    // Content indent comes from the first non-blank line of the body.
    let contentIndent = null;
    while (j < lines.length) {
      if (isBlank(lines[j])) {
        j++;
        continue;
      }
      if (indentOf(lines[j]) <= keyCol) break;
      contentIndent = indentOf(lines[j]);
      break;
    }
    if (contentIndent === null) {
      return { next: i + 1, node: null };
    }
    let end = j;
    while (end < lines.length) {
      if (isBlank(lines[end])) {
        end++;
        continue;
      }
      if (indentOf(lines[end]) < contentIndent) break;
      end++;
    }
    // Trailing blank lines belong to the document, not the scalar.
    let last = end;
    while (last > j && isBlank(lines[last - 1])) last--;
    const bodyLines = lines.slice(j, last);
    return {
      next: end,
      node: {
        style,
        chomp,
        contentIndent,
        valueStart: offsets[j],
        valueEnd: offsets[last - 1] + lines[last - 1].length,
        value: decodeBlock(bodyLines, contentIndent, style),
      },
    };
  }

  if (rest.startsWith('"') || rest.startsWith("'")) {
    const quote = rest[0];
    let buf = rest;
    let j = i;
    let closed = false;
    let k = 1;
    while (true) {
      while (k < buf.length) {
        if (quote === '"' && buf[k] === "\\") {
          k += 2;
          continue;
        }
        if (buf[k] === quote) {
          if (quote === "'" && buf[k + 1] === "'") {
            k += 2;
            continue;
          }
          closed = true;
          break;
        }
        k++;
      }
      if (closed || j + 1 >= lines.length) break;
      j++;
      buf += "\n" + lines[j];
    }
    if (!closed) return { next: i + 1, node: null };
    const raw = buf.slice(0, k + 1);
    return {
      next: j + 1,
      node: {
        style: quote === '"' ? "double" : "single",
        contentIndent: restCol,
        valueStart: offsets[i] + restCol,
        valueEnd: offsets[i] + restCol + raw.length,
        value: quote === '"' ? decodeDouble(raw) : decodeSingle(raw),
      },
    };
  }

  if (rest === "" || rest.startsWith("#")) return { next: i + 1, node: null };

  // Plain scalar, to end of line. Strip a trailing comment only when it is
  // clearly one (preceded by whitespace).
  let text = rest;
  const hash = / +#/.exec(text);
  if (hash) text = text.slice(0, hash.index);
  text = text.replace(/\s+$/, "");
  return {
    next: i + 1,
    node: {
      style: "plain",
      contentIndent: restCol,
      valueStart: offsets[i] + restCol,
      valueEnd: offsets[i] + restCol + text.length,
      value: text,
    },
  };
}

// Reads a block sequence whose items are scalars, starting at line i.
function readSequence(ctx, i, parentCol) {
  const { lines } = ctx;
  const items = [];
  let j = i;
  let seqIndent = null;
  while (j < lines.length) {
    const line = lines[j];
    if (isBlank(line) || isComment(line)) {
      j++;
      continue;
    }
    const ind = indentOf(line);
    if (ind <= parentCol) break;
    const m = /^(\s*)-(\s+)(.*)$/.exec(line);
    if (!m) break;
    if (seqIndent === null) seqIndent = ind;
    if (ind !== seqIndent) break;
    const itemCol = m[1].length + 1 + m[2].length;
    const { next, node } = readValue(ctx, j, m[3], ind);
    if (node) items.push(node);
    j = next === j + 1 && node === null ? j + 1 : next;
    void itemCol;
  }
  return { next: j, items };
}

/**
 * Find every prose scalar under one of `keys`.
 *
 * Every key is scanned (not just the targets) so that block scalars are
 * consumed correctly — a Markdown body inside a `|-` can contain a line that
 * looks exactly like `description:`, and it must not be mistaken for one.
 */
function findScalars(text, keys) {
  const ctx = lineOffsets(text);
  const { lines } = ctx;
  const targets = new Set(keys);
  const found = [];
  const counters = new Map();

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (isBlank(line) || isComment(line)) {
      i++;
      continue;
    }
    const m = KEY_RE.exec(line);
    if (!m) {
      i++;
      continue;
    }
    const key = m[3];
    const rest = m[5];
    const keyCol = m[1].length + (m[2] || "").length;
    const wanted = targets.has(key);

    if (rest === "" || rest.startsWith("#")) {
      // Nested map or sequence. Peek for a sequence of scalars.
      let p = i + 1;
      while (p < lines.length && (isBlank(lines[p]) || isComment(lines[p]))) p++;
      if (p < lines.length && indentOf(lines[p]) > keyCol && /^\s*-\s+\S/.test(lines[p])) {
        const { next, items } = readSequence(ctx, p, keyCol);
        if (wanted) {
          const n = (counters.get(key) || 0) + 1;
          counters.set(key, n);
          items.forEach((node, idx) => {
            found.push({ key, occurrence: n, index: idx, line: i + 1, ...node });
          });
          i = next;
          continue;
        }
        // Not a target: fall through and keep scanning inside it.
      }
      i++;
      continue;
    }

    const { next, node } = readValue(ctx, i, rest, keyCol);
    if (node && wanted) {
      const n = (counters.get(key) || 0) + 1;
      counters.set(key, n);
      found.push({ key, occurrence: n, index: null, line: i + 1, ...node });
    }
    i = next > i ? next : i + 1;
  }

  return found;
}

module.exports = { findScalars, encodeScalar };
