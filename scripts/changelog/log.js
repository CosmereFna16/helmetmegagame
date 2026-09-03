// The changelog writer. One entry per push, in CHANGELOG.md and in Discord.
//
// The audience is the GM team, not a diff reader. An entry says what changed in
// the *game* — "the good labor spots now wear out as they are worked" — never
// which files moved. File paths mean nothing to a GM, and half of them would be
// noise anyway.
//
// So the notes are written by whoever pushes:
//
//   npm run push -- "Subject" "Rebalanced the labor yields" "+Labor? button"
//
// The first argument is the heading. Every argument after it is one note. A
// note may open with its own glyph; without one it is treated as a change (✎).
//
//   ✚  something new players or GMs can now do
//   −  something that went away
//   ✎  something that works differently now
//
// Those three are deliberate: none of them is a Markdown list marker, so the
// lines render literally on GitHub and in Discord with no code fence around
// them — which matters, because prose inside a fence does not wrap.
//
// `npm run push -- "Subject" --hidden` skips both halves entirely. Some pushes
// are not the GMs' business, and there is no partial version of that: nothing
// is written to CHANGELOG.md and nothing is posted.
//
// Two subjects are held back by default, whether or not --hidden is passed:
// the setting's deep lore and the antagonist seats. Players read over GM
// shoulders and GMs get briefed on those deliberately, in order. See
// SENSITIVE_PATHS / SENSITIVE_WORDS below.
//
// Committed by hand instead? `npm run changelog` reads HEAD and does both. It
// takes its notes from the commit message body — any body line starting with a
// glyph, a "-", or a "*" counts.
require("dotenv").config();
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

// Not a secret — anyone in the guild can read a channel id, and Bascinet runs
// in exactly one guild, so there is one correct value and it can never differ
// per environment. Same reasoning as db/lib/roleIds.js. The env var is an
// override for a throwaway test channel, not the normal path.
const CHANNEL_ID = process.env.CHANGELOG_CHANNEL_ID || "1545157496304566354";

const ROOT = path.resolve(__dirname, "..", "..");
const FILE = path.join(ROOT, "CHANGELOG.md");

// Long enough to read a push at a glance, short enough that nobody scrolls.
const MAX_NOTES = 12;

// Touch one of these and the push is lore or antagonist work. It is withheld
// unless the pusher says otherwise with --tell-gms, because the GMs are briefed
// on this material on purpose and in order, not by changelog.
const SENSITIVE_PATHS = [
  "docs/lore.md",
  "docs/threats.md",
  "docs/archive/",
  "db/lib/antagonists.js",
];

// A second net, over the words rather than the files: a note can give away a
// secret while touching nothing on the list above. This one only warns.
const SENSITIVE_WORDS = /\b(lore|antagonist|threat seat|the tower'?s secret|windlander|bacchus)\b/i;

const HEADER = `# Changelog

Every push, newest first, in plain language for the GM team. Written by
\`npm run push\` and mirrored to Discord — see CLAUDE.md.
\`✚\` new, \`−\` gone, \`✎\` changed.
`;

function git(args) {
  return execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).trim();
}

const GLYPHS = { "✚": "✚", "−": "−", "✎": "✎", "+": "✚", "-": "−", "~": "✎" };

// A note may lead with a glyph ("+Labor? button", "✎ yields drift"). Anything
// else is a change, which is what most pushes are.
function normalizeNote(raw) {
  const text = String(raw).trim();
  if (!text) return null;
  const lead = text[0];
  const glyph = GLYPHS[lead];
  if (!glyph) return `✎ ${text}`;
  return `${glyph} ${text.slice(1).trim()}`.trim();
}

function clamp(notes) {
  if (notes.length <= MAX_NOTES) return notes;
  return [...notes.slice(0, MAX_NOTES), `… and ${notes.length - MAX_NOTES} more`];
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

// Newest first, so the entry goes directly under the header rather than at the
// end of a file nobody scrolls to the bottom of.
function prepend(entry) {
  const existing = fs.existsSync(FILE) ? fs.readFileSync(FILE, "utf8") : null;
  if (!existing) {
    fs.writeFileSync(FILE, `${HEADER}\n${entry}\n`);
    return;
  }
  const marker = existing.indexOf("\n## ");
  const head = marker === -1 ? existing.trimEnd() : existing.slice(0, marker).trimEnd();
  const rest = marker === -1 ? "" : existing.slice(marker + 1);
  fs.writeFileSync(FILE, `${head}\n\n${entry}\n\n${rest}`.trimEnd() + "\n");
}

function changedPaths(staged) {
  const raw = staged
    ? git(["diff", "--cached", "--name-only"])
    : git(["show", "--name-only", "--pretty=format:", "HEAD"]);
  return raw.split("\n").map((l) => l.trim()).filter(Boolean);
}

function sensitiveHits(paths) {
  return paths.filter((p) => SENSITIVE_PATHS.some((s) => (s.endsWith("/") ? p.startsWith(s) : p === s)));
}

// Notes from a hand-written commit body: any line that opens with a glyph or an
// ordinary list marker. Prose paragraphs in the body are left alone.
function notesFromCommitBody() {
  const body = git(["log", "-1", "--pretty=%b"]);
  return body
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => /^[✚−✎+\-*]\s*\S/.test(l))
    .map((l) => normalizeNote(l.replace(/^\*/, "✎")))
    .filter(Boolean);
}

// Two trailing spaces per line: without a hard break GitHub reflows the notes
// into one run-on paragraph. Discord needs no such help.
function fileEntry(subject, notes) {
  const body = clamp(notes).map((n, i, all) => (i === all.length - 1 ? n : `${n}  `));
  return [`## ${today()} · ${subject}`, "", ...body].join("\n");
}

function discordBody(subject, notes, hash) {
  return [`**${subject}**`, `-# \`${hash}\` · ${today()}`, ...clamp(notes)].join("\n");
}

async function announce(subject, notes, hash) {
  const { postMessageBatched } = require("../../db/lib/discordRest");
  await postMessageBatched(CHANNEL_ID, discordBody(subject, notes, hash));
}

function collect(argv, flag) {
  const out = [];
  for (let i = 0; i < argv.length; i += 1) if (argv[i] === flag && argv[i + 1] !== undefined) out.push(argv[i + 1]);
  return out;
}

async function main() {
  const argv = process.argv.slice(2);
  const staged = argv.includes("--staged");
  const announceOnly = argv.includes("--announce");
  const dryRun = argv.includes("--dry-run");
  const hidden = argv.includes("--hidden") || argv.includes("--secret");
  const tellGms = argv.includes("--tell-gms");

  if (hidden) {
    console.log("changelog: hidden push — nothing written, nothing announced.");
    return;
  }

  const msgFlag = argv.indexOf("--message");
  const subject = (msgFlag !== -1 ? argv[msgFlag + 1] : git(["log", "-1", "--pretty=%s"])).split("\n")[0].trim();

  const secret = sensitiveHits(changedPaths(staged));
  if (secret.length && !tellGms) {
    console.log(
      `changelog: held back — this push touches ${secret.join(", ")}, which the GMs are briefed on separately. ` +
        "Pass --tell-gms to log it anyway.",
    );
    return;
  }
  if (SENSITIVE_WORDS.test(subject)) {
    console.warn("changelog: heads up — the subject names lore or antagonist material. The GMs will read it.");
  }

  const given = msgFlag !== -1 ? collect(argv, "--note") : [...collect(argv, "--note"), ...notesFromCommitBody()];
  const notes = given.map(normalizeNote).filter(Boolean);

  // No notes is fine and common: the subject is already the plain-language
  // sentence, so the entry is just its heading rather than an empty body.
  if (announceOnly) {
    const hash = git(["rev-parse", "--short", "HEAD"]);
    if (dryRun) {
      console.log(`changelog: would post to ${CHANNEL_ID}\n${discordBody(subject, notes, hash)}`);
      return;
    }
    // Best-effort by design: the push already succeeded, and a Discord outage
    // is not a reason to fail the run. Log loudly enough to notice.
    try {
      await announce(subject, notes, hash);
      console.log("changelog: announced to Discord.");
    } catch (err) {
      console.warn(`changelog: Discord announce failed (the push is fine): ${err.message}`);
    }
    return;
  }

  const entry = fileEntry(subject, notes);
  if (dryRun) {
    console.log(entry);
    return;
  }
  prepend(entry);
  console.log(`changelog: logged ${notes.length} note${notes.length === 1 ? "" : "s"}.`);

  // --staged is the push path, and it stops here: the commit has not been made
  // yet, so there is no hash to announce and no push worth announcing. Every
  // other invocation is somebody logging a commit by hand, and wants both.
  if (staged) return;
  const hash = git(["rev-parse", "--short", "HEAD"]);
  try {
    await announce(subject, notes, hash);
    console.log("changelog: announced to Discord.");
  } catch (err) {
    console.warn(`changelog: Discord announce failed (CHANGELOG.md is written): ${err.message}`);
  }
}

main().catch((err) => {
  console.warn(`changelog: skipped (${err.message})`);
});
