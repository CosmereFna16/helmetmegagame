// Load real pages against the local dev server, signed in, and report what
// happened. The companion to session.mjs — see that file for why minting a
// cookie is safe and why no application code changes.
//
// This exists because the failure this repo has actually shipped is a page that
// builds clean and lints clean and throws only when someone opens it (the
// `no-undef` note in CLAUDE.md). Nothing catches that except opening it.
//
//   npm run dev:check                             # the whole matrix below
//   npm run dev:check -- --gm /gm/turns           # named routes, as a superadmin
//   npm run dev:check -- --character "Aezir" /faction
//   npm run dev:check -- --anon /character        # no cookie
//
// Exits non-zero if anything fails, so it can gate a change.

import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { mintCookie, resolveTarget } from "./session.mjs";

const BASE = process.env.DEV_CHECK_BASE ?? "http://localhost:3000";

// Routes, who should be looking at them, and where a redirect is the CORRECT
// answer. Several of these gates are load-bearing, so the negative cases at the
// bottom are the point of the file as much as the positive ones: they fail if
// someone loosens a gate by accident.
//
// `expect` is a redirect target. Its absence means "must render".
const DEFAULT_ROUTES = [
  // The one public route, so it doubles as "is the server up and is it this app".
  { path: "/handbook", as: "public" },

  // Player surfaces.
  { path: "/character", as: "player" },
  { path: "/depot", as: "player" },
  { path: "/documents", as: "player" },
  { path: "/faction", as: "player" },
  { path: "/notes", as: "player" },

  // Deliberate redirect stubs, kept so old links still land somewhere:
  // web/app/(app)/store/page.js and web/app/(app)/gm/page.js.
  { path: "/store", as: "player", expect: "/character" },
  { path: "/gm", as: "gm", expect: "/gm/players" },

  // Conditional on game state — a GM always passes, a player only sometimes,
  // so these are checked as a GM to keep the run stable.
  // (web/app/(app)/archive/page.js:33, web/app/(app)/lifeweb/page.js:39)
  { path: "/archive", as: "gm" },
  { path: "/lifeweb", as: "gm" },

  // GM desk and dev panel.
  { path: "/gm/players", as: "gm" },
  { path: "/gm/turns", as: "gm" },
  { path: "/gm/audit", as: "gm" },
  { path: "/gm/gamemasters", as: "gm" },
  { path: "/gm/dev", as: "gm" },
  { path: "/gm/dev/characters", as: "gm" },
  { path: "/gm/dev/factions", as: "gm" },
  { path: "/gm/dev/tags", as: "gm" },

  // The gates themselves. A pass here means the door is still shut.
  { path: "/character", as: "anon", expect: "/" },
  { path: "/gm/turns", as: "anon", expect: "/" },
  { path: "/gm/turns", as: "player", expect: "/character" },
  { path: "/gm/players", as: "player", expect: "/character" },
  { path: "/gm/dev", as: "player", expect: "/character" },
  // Superadmin-gated too, but it bounces to /gm/players rather than
  // /character (web/app/(app)/gm/gamemasters/page.js:20), and the (desk)
  // layout then bounces a non-GM on from there. Two hops, same door.
  { path: "/gm/gamemasters", as: "player", expect: "/gm/players" },
];

// A server component that throws still answers 200: React streams the shell,
// then encodes the error as a flight row in the RSC payload rather than
// changing the status line. So status alone would miss the single failure this
// script exists to catch — a page that builds clean, lints clean, and throws
// only when opened.
//
// The row looks like `3f:E{"digest":"3960263124","name":"ReferenceError",
// "message":"X is not defined",...}`, backslash-escaped inside a <script>.
// Production emits the same row with the name and message stripped, leaving
// the digest — which is why the digest, not the message, is what's matched.
const FLIGHT_ERROR = /[0-9a-f]+:E\{\\?"digest\\?":\\?"([^"\\]+)/;
// The message is JSON-escaped inside a script string, so newlines arrive as
// literal `\n` and quotes as `\"`. Accept escapes rather than stopping at the
// first one, or a Prisma error (which is mostly newlines) reports as blank.
const ERROR_NAME = /\\?"name\\?":\\?"([A-Za-z]*Error)\\?",\\?"message\\?":\\?"((?:[^"\\]|\\.){0,400})/;

function bodyError(html) {
  const flight = html.match(FLIGHT_ERROR);
  if (!flight) return null;
  const detail = html.match(ERROR_NAME);
  if (!detail) return `server error, digest ${flight[1]}`;

  const message = detail[2]
    // Turbopack rewrites `prisma` into a mangled module accessor that is most
    // of the line and none of the meaning.
    .replace(/__TURBOPACK__[A-Za-z0-9_$]*\[\\*"([^"\\]+)\\*"\]/g, "$1")
    // Collapse the escaped newlines so the report stays one row per route.
    // Escaped newlines arrive as one or more backslashes then `n`.
    .replace(/\\+n/g, " ")
    .replace(/\\+(.)/g, "$1")
    .replace(/\s+/g, " ")
    // Prisma appends the failing call site and a source excerpt; the call
    // itself is the useful part and the rest is a .next/ chunk path.
    .replace(/ invocation in .*$/, "")
    .trim()
    .slice(0, 110);

  return message ? `${detail[1]}: ${message}` : detail[1];
}

// A redirect() called from a *page* rather than a layout usually lands after
// streaming has begun, so the status line is already committed to 200 and the
// real instruction rides along in the RSC payload instead. /gm/dev is the case
// that caught this: a non-superadmin gets a 200 whose body carries
// `NEXT_REDIRECT;replace;/character;307;` and no panel content.
//
// Treating that as a pass would make this script worthless for exactly the
// gates it most needs to check, so the body is the authority, not the status.
function streamedRedirect(html) {
  const match = html.match(/NEXT_REDIRECT[;,]([a-z]+)[;,]([^;,"\\]+)/);
  return match ? match[2] : null;
}

async function probe(path, cookie) {
  const started = Date.now();
  let res;
  try {
    // redirect: "manual" so an auth bounce stays visible. Following it would
    // report a cheerful 200 for a page that never rendered.
    res = await fetch(BASE + path, {
      headers: cookie ? { cookie } : {},
      redirect: "manual",
    });
  } catch (err) {
    return { ms: Date.now() - started, note: `unreachable — ${err.message}` };
  }

  const ms = Date.now() - started;
  const status = res.status;

  if (status >= 300 && status < 400) {
    return { ms, status, redirect: res.headers.get("location") };
  }
  if (status >= 400) return { ms, status, note: "error status" };

  const html = await res.text();

  const streamed = streamedRedirect(html);
  if (streamed) return { ms, status, redirect: streamed, streamed: true };

  const marker = bodyError(html);
  if (marker) return { ms, status, note: `rendered an error (${marker})` };

  return { ms, status, rendered: true };
}

// Compare a redirect target ignoring its query string, so /faction ->
// /gm/players?tab=factions still matches an expectation of /gm/players.
function redirectMatches(actual, expected) {
  return actual && actual.split("?")[0] === expected.split("?")[0];
}

function judge(result, expect) {
  if (result.note) return { ok: false, note: result.note };

  if (expect) {
    if (!result.redirect) return { ok: false, note: `expected redirect -> ${expect}, but it rendered` };
    return redirectMatches(result.redirect, expect)
      ? { ok: true, note: `-> ${result.redirect}` }
      : { ok: false, note: `expected -> ${expect}, got -> ${result.redirect}` };
  }

  if (result.redirect) {
    return { ok: false, note: `${result.streamed ? "streamed " : ""}redirect -> ${result.redirect}` };
  }
  return { ok: true, note: "" };
}

// The player persona needs some real ALIVE character. Any one will do, so take
// the first alphabetically for a stable, reproducible run.
async function defaultPlayer() {
  const require = createRequire(import.meta.url);
  const { prisma } = require("@lifeweb/db");
  const character = await prisma.character.findFirst({
    where: { status: "ALIVE" },
    select: { name: true, discordUserId: true },
    orderBy: { name: "asc" },
  });
  await prisma.$disconnect();
  if (!character) throw new Error("No ALIVE character in the database to check player routes with.");
  return character;
}

async function runMatrix() {
  const gm = await resolveTarget(["--gm"]);
  const player = await defaultPlayer();

  const cookies = {
    public: null,
    anon: null,
    gm: await mintCookie(gm.discordUserId),
    player: await mintCookie(player.discordUserId),
  };

  console.log(`${BASE}`);
  console.log(`  gm      ${gm.label}`);
  console.log(`  player  ${player.name}\n`);

  const failures = [];
  for (const route of DEFAULT_ROUTES) {
    const result = await probe(route.path, cookies[route.as]);
    const verdict = judge(result, route.expect);
    if (!verdict.ok) failures.push(route);
    console.log(
      `${verdict.ok ? "ok  " : "FAIL"} ${String(result.status ?? "---").padEnd(3)} ` +
        `${route.as.padEnd(6)} ${route.path.padEnd(22)} ${String(result.ms).padStart(5)}ms` +
        (verdict.note ? `  ${verdict.note}` : ""),
    );
  }

  console.log(`\n${DEFAULT_ROUTES.length - failures.length}/${DEFAULT_ROUTES.length} ok`);
  return failures.length === 0;
}

async function runRoutes(argv, routes) {
  const anon = argv.includes("--anon");
  let cookie = null;
  let who = "anonymous";
  if (!anon) {
    // Strip route paths so a leading "/gm/turns" is never read as a target.
    const target = await resolveTarget(argv.filter((a) => !a.startsWith("/")));
    cookie = await mintCookie(target.discordUserId);
    who = target.label;
  }

  console.log(`${BASE} as ${who} — ${routes.length} route${routes.length === 1 ? "" : "s"}\n`);

  let failures = 0;
  for (const path of routes) {
    // Serial on purpose: `next dev` compiles routes on demand, so a parallel
    // burst makes every timing meaningless and can starve the compiler.
    const result = await probe(path, cookie);
    const verdict = judge(result, null);
    if (!verdict.ok) failures++;
    console.log(
      `${verdict.ok ? "ok  " : "FAIL"} ${String(result.status ?? "---").padEnd(3)} ` +
        `${path.padEnd(22)} ${String(result.ms).padStart(5)}ms` +
        (verdict.note ? `  ${verdict.note}` : ""),
    );
  }

  console.log(`\n${routes.length - failures}/${routes.length} ok`);
  return failures === 0;
}

async function main() {
  const argv = process.argv.slice(2);
  const routes = argv.filter((a) => a.startsWith("/"));
  const ok = routes.length ? await runRoutes(argv, routes) : await runMatrix();
  if (!ok) process.exit(1);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
