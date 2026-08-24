// Pulls player-facing strings out of JavaScript/JSX by byte offset.
//
// AST rather than regex, because JSX text has no delimiters a regex can trust
// and because the noise ratio in a Tailwind codebase is brutal — every
// className is a long, space-separated, English-looking string.
//
// Like the YAML side, this only ever reports ranges. Nothing is rewritten here.

let parser;
try {
  parser = require("@babel/parser");
} catch {
  console.error(
    "scripts/copy needs @babel/parser and @babel/traverse.\n" +
      "  npm i -D @babel/parser @babel/traverse\n",
  );
  process.exit(1);
}

const {
  COPY_PROPS,
  COPY_CALLS,
  COPY_CONSTANTS,
  COPY_OBJECT_KEYS,
  REPLY_CALLS,
  REPLY_KEYS,
  EMBED_CALLS,
  EMBED_KEYS,
  LOOSE_ROOTS,
  LOOSE_MIN_WORDS,
} = require("./sources.js");

const PARSE_OPTIONS = {
  sourceType: "unambiguous",
  allowReturnOutsideFunction: true,
  errorRecovery: true,
  plugins: ["jsx", "classProperties", "objectRestSpread", "optionalChaining", "nullishCoalescingOperator", "topLevelAwait"],
};

// --- noise filters ----------------------------------------------------------

const TAILWIND_HINT =
  /(^|\s)(flex|grid|hidden|block|inline|absolute|relative|sticky|fixed|truncate|items-|justify-|self-|gap-|p[xytblr]?-|m[xytblr]?-|w-|h-|min-|max-|text-|bg-|border|rounded|shadow|opacity-|z-|overflow-|space-|col-|row-|sr-only|whitespace-|font-|leading-|tracking-|cursor-|select-|transition|duration-|ease-|hover:|focus:|active:|disabled:|sm:|md:|lg:|xl:)/;

const CSS_VAR = /var\(--|^--[\w-]+$/;
const LOOKS_LIKE_PATH = /^[./@]|\.(js|jsx|json|css|png|svg|webp|yaml|md)$/;
const LOOKS_LIKE_URL = /^(https?:|mailto:|data:|\/api\/|\/gm\/|\/[a-z-]+\/?$)/;
const ENUM_LIKE = /^[A-Z][A-Z0-9_]*$/;
const IDENT_LIKE = /^[a-z][a-zA-Z0-9]*$/;
const SLUG_LIKE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const HEX = /^#?[0-9a-fA-F]{3,8}$/;
const DISCORD_SNOWFLAKE = /^\d{15,}$/;
const CRON_LIKE = /^[\d*/,\- ]+$/;

function wordCount(s) {
  return s.trim().split(/\s+/).filter(Boolean).length;
}

function isNoise(value, { forced }) {
  const v = value.trim();
  if (!v) return true;
  if (HEX.test(v) || DISCORD_SNOWFLAKE.test(v) || CRON_LIKE.test(v)) return true;
  if (CSS_VAR.test(v)) return true;
  if (LOOKS_LIKE_PATH.test(v)) return true;
  if (LOOKS_LIKE_URL.test(v)) return true;
  if (TAILWIND_HINT.test(v) && !/[.!?,]/.test(v)) return true;
  if (forced) return false;
  if (ENUM_LIKE.test(v) || IDENT_LIKE.test(v) || SLUG_LIKE.test(v)) return true;
  // Unforced strings need real sentence weight to be worth a worksheet row.
  return wordCount(v) < 3;
}

// --- node readers -----------------------------------------------------------

function readStringNode(node, code) {
  if (!node) return null;
  if (node.type === "StringLiteral") {
    const raw = code.slice(node.start, node.end);
    return {
      style: "string",
      quote: raw[0],
      start: node.start,
      end: node.end,
      value: node.value,
    };
  }
  if (node.type === "TemplateLiteral") {
    // Keep ${...} in the text the user edits — the interpolations are part of
    // the sentence, and hiding them would make the copy unwritable.
    if (node.expressions.some((e) => e.type === "TemplateLiteral")) return null;
    const inner = code.slice(node.start + 1, node.end - 1);
    return {
      style: "template",
      start: node.start,
      end: node.end,
      value: inner,
    };
  }
  return null;
}

function jsxTextNode(node, code) {
  const raw = code.slice(node.start, node.end);
  const lead = /^\s*/.exec(raw)[0];
  const trail = /\s*$/.exec(raw)[0];
  const text = raw.slice(lead.length, raw.length - trail.length);
  if (!text) return null;
  return {
    style: "jsx",
    lead,
    trail,
    start: node.start,
    end: node.end,
    value: text.replace(/\s+/g, " "),
  };
}

// --- walker -----------------------------------------------------------------

function calleeName(node) {
  const c = node.callee;
  if (!c) return null;
  if (c.type === "Identifier") return c.name;
  if (c.type === "MemberExpression" && c.property.type === "Identifier") return c.property.name;
  if (c.type === "NewExpression") return calleeName(c);
  return null;
}

// Nearest enclosing function/component name, used to describe the site.
function contextName(stack) {
  for (let i = stack.length - 1; i >= 0; i--) {
    const n = stack[i];
    if (n.type === "FunctionDeclaration" && n.id) return n.id.name;
    if (
      (n.type === "VariableDeclarator" || n.type === "ClassDeclaration") &&
      n.id &&
      n.id.name
    )
      return n.id.name;
  }
  return null;
}

/**
 * @returns {Array<{style,start,end,value,kind,context}>}
 */
function extractStrings(code, file) {
  let ast;
  try {
    ast = parser.parse(code, PARSE_OPTIONS);
  } catch (err) {
    return { entries: [], error: err.message };
  }

  const entries = [];
  const seen = new Set();
  const stack = [];
  const loose = LOOSE_ROOTS.some((r) => file.startsWith(r));

  // A string is off-limits to the loose pass if it is diagnostic output, a
  // module specifier, or a key rather than a value.
  function looseAllowed(node, parent) {
    if (!parent) return false;
    if (parent.type === "ObjectProperty" && parent.key === node) return false;
    if (parent.type === "ImportDeclaration" || parent.type === "ExportNamedDeclaration")
      return false;
    for (let i = stack.length - 1; i >= 0; i--) {
      const a = stack[i];
      if (a.type !== "CallExpression" && a.type !== "NewExpression") continue;
      const c = a.callee;
      if (c && c.type === "MemberExpression" && c.object && c.object.name === "console")
        return false;
      // `throw new Error(...)` is a developer diagnostic, never player copy.
      // UserError is the player-facing one and is matched explicitly above.
      if (c && c.type === "Identifier" && (c.name === "require" || /Error$/.test(c.name)))
        return false;
      if (c && c.type === "Identifier" && /^(getenv|env)$/i.test(c.name)) return false;
    }
    return true;
  }

  function push(node, kind, forced, extra = {}) {
    if (!node) return;
    if (seen.has(node.start)) return;
    if (isNoise(node.value, { forced })) return;
    seen.add(node.start);
    entries.push({ ...node, kind, context: contextName(stack), ...extra });
  }

  // A manual walk keeps an ancestor stack without pulling in @babel/traverse's
  // scope machinery, which this does not need.
  (function visit(node, parent) {
    if (!node || typeof node.type !== "string") return;
    stack.push(node);

    if (node.type === "JSXText") {
      const n = jsxTextNode(node, code);
      if (n && wordCount(n.value) >= 3) push(n, "jsx-text", false);
    }

    if (node.type === "JSXAttribute" && node.name) {
      const name = node.name.name;
      if (COPY_PROPS.has(name) && node.value) {
        const v =
          node.value.type === "JSXExpressionContainer"
            ? node.value.expression
            : node.value;
        if (v && v.type === "StringLiteral") {
          const raw = code.slice(v.start, v.end);
          push(
            { style: "string", quote: raw[0], start: v.start, end: v.end, value: v.value },
            `prop:${name}`,
            true,
          );
        } else {
          push(readStringNode(v, code), `prop:${name}`, true);
        }
      }
    }

    if (node.type === "CallExpression" || node.type === "NewExpression") {
      const name = calleeName(node);
      if (name && COPY_CALLS.has(name)) {
        for (const arg of node.arguments || []) {
          push(readStringNode(arg, code), name === "UserError" ? "UserError" : `call:${name}`, true);
        }
      }
      // discord.js embeds: addFields({ name, value }), setFooter({ text }).
      if (name && EMBED_CALLS.has(name)) {
        for (const arg of node.arguments || []) {
          const objs = arg && arg.type === "ArrayExpression" ? arg.elements : [arg];
          for (const obj of objs) {
            if (!obj || obj.type !== "ObjectExpression") continue;
            for (const prop of obj.properties) {
              if (prop.type !== "ObjectProperty" || !prop.key) continue;
              const k = prop.key.name || prop.key.value;
              if (!EMBED_KEYS.has(k)) continue;
              push(readStringNode(prop.value, code), `embed:${k}`, true);
            }
          }
        }
      }

      // discord.js: reply({ content: "..." }) and friends.
      if (name && REPLY_CALLS.has(name)) {
        for (const arg of node.arguments || []) {
          if (!arg || arg.type !== "ObjectExpression") continue;
          for (const prop of arg.properties) {
            if (prop.type !== "ObjectProperty" || !prop.key) continue;
            const k = prop.key.name || prop.key.value;
            if (!REPLY_KEYS.has(k)) continue;
            push(readStringNode(prop.value, code), `reply:${name}`, true);
          }
        }
      }
    }

    // Object properties named like copy, when they sit inside a copy constant
    // or a command definition.
    if (node.type === "ObjectProperty" && node.key) {
      const k = node.key.name || node.key.value;
      if (COPY_OBJECT_KEYS.has(k)) {
        const inConstant = stack.some(
          (s) =>
            s.type === "VariableDeclarator" && s.id && COPY_CONSTANTS.has(s.id.name),
        );
        const inCommands = /commands\.js$/.test(file);
        if (inConstant || inCommands) {
          push(readStringNode(node.value, code), `key:${k}`, true);
        }
      }
    }

    // Bare string/array members of a copy constant (e.g. WEATHER_MESSAGES).
    if (node.type === "VariableDeclarator" && node.id && COPY_CONSTANTS.has(node.id.name)) {
      const init = node.init;
      if (init && init.type === "ArrayExpression") {
        for (const el of init.elements) push(readStringNode(el, code), `const:${node.id.name}`, true);
      } else if (init && init.type === "ObjectExpression") {
        for (const prop of init.properties) {
          if (prop.type !== "ObjectProperty") continue;
          if (prop.value.type === "ObjectExpression") {
            for (const inner of prop.value.properties) {
              if (inner.type === "ObjectProperty")
                push(readStringNode(inner.value, code), `const:${node.id.name}`, true);
            }
          } else {
            push(readStringNode(prop.value, code), `const:${node.id.name}`, true);
          }
        }
      } else {
        push(readStringNode(init, code), `const:${node.id.name}`, true);
      }
    }

    if (loose && (node.type === "StringLiteral" || node.type === "TemplateLiteral")) {
      const n = readStringNode(node, code);
      if (n && wordCount(n.value) >= LOOSE_MIN_WORDS && looseAllowed(node, parent)) {
        push(n, "loose", false);
      }
    }

    for (const key of Object.keys(node)) {
      if (key === "loc" || key === "leadingComments" || key === "trailingComments") continue;
      const child = node[key];
      if (Array.isArray(child)) {
        for (const c of child) if (c && typeof c.type === "string") visit(c, node);
      } else if (child && typeof child.type === "string") {
        visit(child, node);
      }
    }
    stack.pop();
  })(ast, null);

  entries.sort((a, b) => a.start - b.start);
  return { entries, error: null };
}

// Re-emits an edited value in the style it was found in.
function encodeString(entry, value) {
  if (entry.style === "jsx") return entry.lead + value + entry.trail;
  if (entry.style === "template") return "`" + value + "`";
  const q = entry.quote || '"';
  if (q === '"') return JSON.stringify(value);
  const body = value.replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/\n/g, "\\n");
  return `'${body}'`;
}

module.exports = { extractStrings, encodeString, wordCount };
