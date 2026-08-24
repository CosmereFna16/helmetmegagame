// Checks a rewritten string against the conventions this repo's copy has to
// obey. Everything here is advisory except the Discord length caps, which are
// a hard failure — see below.

const { GUILLEMET_AUTO_KINDS } = require("./sources.js");

// Inline token families. Dropping one silently removes a rendered chip from
// the page: {resource:…} is rendered by web/app/components/ResourceChip.js and
// {partysize:N} by PartySizeChip.js.
const TOKEN_RE = /\{[a-z]+:[^}]*\}/gi;
const INTERP_RE = /\$\{[^}]*\}/g;

// Discord's hard limits. An over-long slash-command description is the
// dangerous one: bot/src/events/ready.js registers with
// client.application.commands.set, a full replace, so one bad string takes out
// every command at once — and a new registration takes up to an hour to
// propagate, so the fix is slow as well as total.
function discordLimit(entry) {
  const f = entry.file || "";
  const k = entry.kind || "";
  const inCommands = /bot\/src\/lib\/commands\.js$/.test(f);
  if (inCommands && (k === "key:description" || k === "call:setDescription"))
    return { max: 100, what: "slash command / option description" };
  if (inCommands && (k === "key:name" || k === "key:label"))
    return { max: 100, what: "slash command choice name" };
  if (k === "call:setPlaceholder") return { max: 100, what: "modal placeholder" };
  if (k === "call:setLabel") return { max: 45, what: "modal input label" };
  if (k === "call:setTitle") return { max: 45, what: "modal title" };
  if (k === "embed:value") return { max: 1024, what: "embed field value" };
  if (k === "embed:name") return { max: 256, what: "embed field name" };
  if (k === "call:setDescription") return { max: 4096, what: "embed description" };
  if (k.startsWith("reply:") || k === "call:sendDm")
    return { max: 2000, what: "Discord message" };
  return null;
}

function multiset(str, re) {
  const m = str.match(re) || [];
  const counts = new Map();
  for (const x of m) counts.set(x, (counts.get(x) || 0) + 1);
  return counts;
}

function missingFrom(oldStr, newStr, re) {
  const a = multiset(oldStr, re);
  const b = multiset(newStr, re);
  const lost = [];
  for (const [k, n] of a) {
    const have = b.get(k) || 0;
    if (have < n) lost.push(k);
  }
  return lost;
}

/**
 * @returns {Array<{level:'error'|'warn', message:string}>}
 */
function checkEntry(entry, oldValue, newValue) {
  const issues = [];
  const add = (level, message) => issues.push({ level, message });

  // --- hard: Discord length caps -------------------------------------------
  const limit = discordLimit(entry);
  if (limit) {
    // Interpolations expand at runtime; measure the literal text and warn near
    // the edge rather than pretending we know the final length.
    const bare = newValue.replace(INTERP_RE, "");
    if (newValue.length > limit.max) {
      add(
        "error",
        `${newValue.length} chars exceeds the ${limit.max}-char Discord cap for a ${limit.what}.`,
      );
    } else if (INTERP_RE.test(newValue) && bare.length > limit.max * 0.8) {
      add(
        "warn",
        `${bare.length} chars before interpolation, against a ${limit.max}-char cap for a ${limit.what}. Tight.`,
      );
    }
  }

  // --- tokens and interpolations -------------------------------------------
  const lostTokens = missingFrom(oldValue, newValue, TOKEN_RE);
  if (lostTokens.length)
    add("warn", `drops token(s) the original carried: ${lostTokens.join(", ")}`);

  const lostInterp = missingFrom(oldValue, newValue, INTERP_RE);
  if (lostInterp.length)
    add("warn", `drops interpolation(s): ${lostInterp.join(", ")}`);

  // --- the Resources glyph --------------------------------------------------
  // CLAUDE.md: the glyph stands in for the word, it does not sit beside it.
  if (/\bresources?\b[^.!?]{0,12}⬢/i.test(newValue) || /⬢[^.!?]{0,12}\bresources?\b/i.test(newValue))
    add("warn", 'writes the word "Resources" next to ⬢ — a quantity is "3 ⬢", never "3 Resources ⬢".');
  if (/\{resource:[^}]*\}\s*⬢/.test(newValue))
    add("warn", "puts ⬢ after a {resource:…} bubble, which renders its own glyph.");
  if (/\{partysize:[^}]*\}\s*⬢/.test(newValue))
    add("warn", "adds ⬢ to a party size — that is a count of people, not a currency.");

  // --- the » prefix ---------------------------------------------------------
  if (GUILLEMET_AUTO_KINDS.has(entry.kind) && newValue.trimStart().startsWith("»"))
    add("warn", "starts with » in a sendDm body — sendDm applies that prefix itself, so this doubles it.");
  if (!GUILLEMET_AUTO_KINDS.has(entry.kind) && oldValue.trimStart().startsWith("»") && !newValue.trimStart().startsWith("»"))
    add("warn", "drops the leading » that marks this as bot voice.");

  // --- small typographic conventions ---------------------------------------
  if (/\d\s*–\s*\d/.test(oldValue) && /\d\s*-\s*\d/.test(newValue) && !/\d\s*–\s*\d/.test(newValue))
    add("warn", "replaces the en dash in a numeric range with a hyphen.");
  if (oldValue.includes("-#") && !newValue.includes("-#"))
    add("warn", "drops the Discord `-#` subtext marker.");

  return issues;
}

module.exports = { checkEntry, discordLimit };
