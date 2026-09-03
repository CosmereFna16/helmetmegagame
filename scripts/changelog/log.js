// The changelog writer. One entry per push, in CHANGELOG.md and in Discord.
//
// `npm run push -- "Message"` calls this with --staged BEFORE the commit, so
// the entry it writes rides along inside that same commit rather than trailing
// behind it in a second one. After the push it is called again with --announce
// to post the same entry to Discord, which is the half that is allowed to fail:
// a missing DISCORD_TOKEN must never turn a successful push into a red run.
//
// Committed by hand instead? `npm run changelog` reads HEAD and does both.
//
// The symbols are the whole format, and they are the user's:
//   +  a file that arrived
//   -  a file that went away
//   ✎  a file that changed
//
// They sit inside a fenced block on purpose. Both GitHub and Discord treat a
// leading "+" or "-" as a list marker and would eat them; a fence renders all
// three literally and keeps the paths aligned.
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

// Long enough to read a commit at a glance, short enough that nobody scrolls.
const MAX_LINES_FILE = 30;
const MAX_LINES_DISCORD = 20;

const HEADER = `# Changelog

Every push, newest first. Written by \`npm run push\` and mirrored to Discord —
see CLAUDE.md. \`+\` added, \`-\` removed, \`✎\` changed.
`;

function git(args) {
  return execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).trim();
}

const SYMBOLS = { A: "+", C: "+", D: "-", M: "✎", T: "✎", R: "✎" };

// `git --name-status` lines are "<status>\t<path>", except a rename, which is
// "R096\t<old>\t<new>" — hence the split-and-take-last rather than a [1].
function parseNameStatus(raw) {
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const parts = line.split("\t");
      const code = parts[0][0];
      const symbol = SYMBOLS[code] || "✎";
      const shown = code === "R" && parts.length > 2 ? `${parts[1]} → ${parts[2]}` : parts[parts.length - 1];
      return `${symbol} ${shown}`;
    })
    .sort((a, b) => a.localeCompare(b));
}

function clamp(lines, max) {
  if (lines.length <= max) return lines;
  return [...lines.slice(0, max), `… and ${lines.length - max} more`];
}

function fence(lines, max) {
  return ["```", ...clamp(lines, max), "```"].join("\n");
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

function discordBody(subject, lines, hash) {
  return [`**${subject}**`, `-# \`${hash}\` · ${today()}`, fence(lines, MAX_LINES_DISCORD)].join("\n");
}

async function announce(subject, lines, hash) {
  const { postMessageBatched } = require("../../db/lib/discordRest");
  await postMessageBatched(CHANNEL_ID, discordBody(subject, lines, hash));
}

async function main() {
  const argv = process.argv.slice(2);
  const staged = argv.includes("--staged");
  const announceOnly = argv.includes("--announce");
  const dryRun = argv.includes("--dry-run");

  const msgFlag = argv.indexOf("--message");
  const subject = (msgFlag !== -1 ? argv[msgFlag + 1] : git(["log", "-1", "--pretty=%s"])).split("\n")[0].trim();

  const raw = staged
    ? git(["diff", "--cached", "--name-status"])
    : git(["show", "--name-status", "--pretty=format:", "HEAD"]);
  const lines = parseNameStatus(raw);

  if (!lines.length) {
    console.log("changelog: nothing to log.");
    return;
  }

  if (announceOnly) {
    const hash = git(["rev-parse", "--short", "HEAD"]);
    if (dryRun) {
      console.log(`changelog: would post to ${CHANNEL_ID}\n${discordBody(subject, lines, hash)}`);
      return;
    }
    // Best-effort by design: the push already succeeded, and a Discord outage
    // is not a reason to fail the run. Log loudly enough to notice.
    try {
      await announce(subject, lines, hash);
      console.log(`changelog: announced to Discord (${lines.length} file${lines.length === 1 ? "" : "s"}).`);
    } catch (err) {
      console.warn(`changelog: Discord announce failed (the push is fine): ${err.message}`);
    }
    return;
  }

  const entry = [`## ${today()} · ${subject}`, "", fence(lines, MAX_LINES_FILE)].join("\n");
  if (dryRun) {
    console.log(entry);
    return;
  }
  prepend(entry);
  console.log(`changelog: logged ${lines.length} file${lines.length === 1 ? "" : "s"}.`);

  // --staged is the push path, and it stops here: the commit has not been made
  // yet, so there is no hash to announce and no push worth announcing. Every
  // other invocation is somebody logging a commit by hand, and wants both.
  if (staged) return;
  const hash = git(["rev-parse", "--short", "HEAD"]);
  try {
    await announce(subject, lines, hash);
    console.log("changelog: announced to Discord.");
  } catch (err) {
    console.warn(`changelog: Discord announce failed (CHANGELOG.md is written): ${err.message}`);
  }
}

main().catch((err) => {
  console.warn(`changelog: skipped (${err.message})`);
});
