// Mint a valid Auth.js session cookie for local development.
//
// The web app has exactly one auth provider (Discord), so `next dev` on this
// machine can start but never render a page: both route groups redirect on a
// missing session (web/app/(app)/layout.js, web/app/(desk)/layout.js). That
// makes every UI change unverifiable except by reading the diff.
//
// Sessions here are JWTs — web/lib/auth.js configures no adapter, so Auth.js
// uses its JWT strategy — signed with AUTH_SECRET, which is already on this
// machine in web/.env.local. So a cookie can be minted directly with the same
// encode() the app itself uses, and NO application code needs a dev bypass.
// Nothing in web/ changes, so nothing can leak to production.
//
// This grants no authority the holder of AUTH_SECRET doesn't already have.
// GM access in particular is NOT faked: isGm() (web/lib/discordGuild.js) still
// asks Discord for that user's real roles. Impersonating an ID with no GM role
// gets you bounced from /gm exactly like the real thing.
//
//   node scripts/dev/session.mjs --gm
//   node scripts/dev/session.mjs --character "Jorren"
//   node scripts/dev/session.mjs 262426987979735040

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { encode, decode } from "@auth/core/jwt";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

// Must equal the cookie name — Auth.js derives the encryption key from
// (secret, salt), so a mismatch produces a token the app silently rejects and
// you get a redirect instead of an error. Over plain http://localhost the name
// is unprefixed; the `__Secure-` prefix only applies over HTTPS.
export const COOKIE_NAME = "authjs.session-token";

const DEFAULT_MAX_AGE = 24 * 60 * 60;

// The env files are plain KEY=value, so parse them rather than adding a dotenv
// dependency to the root workspace for a dev-only script.
function readEnvFile(path) {
  let raw;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return {};
  }
  const out = {};
  for (const line of raw.split("\n")) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (!match) continue;
    out[match[1]] = match[2].trim().replace(/^["']|["']$/g, "");
  }
  return out;
}

// web/.env.local first: that is the file `next dev` itself loads, so it is the
// secret the running server will actually verify against. The root .env is the
// fallback the bot and Prisma read.
function loadEnv() {
  return {
    ...readEnvFile(resolve(REPO_ROOT, ".env")),
    ...readEnvFile(resolve(REPO_ROOT, "web/.env.local")),
  };
}

function authSecret(env) {
  const secret = env.AUTH_SECRET;
  if (!secret) {
    throw new Error(
      "AUTH_SECRET not found in web/.env.local or .env. The dev server cannot " +
        "have a valid session without it either, so check those files first.",
    );
  }
  return secret;
}

// Read the superadmin list out of web/lib/superadmin.js rather than copying the
// IDs: that file is the existing source of truth for host access, and a second
// copy would drift. It cannot be imported — web/ has no "type": "module", so
// Node would parse its `export const` as CommonJS and throw.
function superadminIds() {
  const path = resolve(REPO_ROOT, "web/lib/superadmin.js");
  const source = readFileSync(path, "utf8");
  const block = source.match(/SUPERADMIN_DISCORD_IDS\s*=\s*\[([^\]]*)\]/);
  const ids = block ? [...block[1].matchAll(/["'](\d{17,20})["']/g)].map((m) => m[1]) : [];
  if (!ids.length) {
    throw new Error(`No Discord IDs parsed out of ${path} — has its shape changed?`);
  }
  return ids;
}

async function characterDiscordId(query, env) {
  // The generated Prisma client is CommonJS, and db/index.js needs DATABASE_URL
  // present before it constructs the singleton.
  if (!process.env.DATABASE_URL && env.DATABASE_URL) {
    process.env.DATABASE_URL = env.DATABASE_URL;
  }
  const require = createRequire(import.meta.url);
  const { prisma } = require("@lifeweb/db");

  // `name` is the denormalized full name every other reader sorts and searches
  // on (db/prisma/schema.prisma, Character.name).
  const matches = await prisma.character.findMany({
    where: { status: "ALIVE", name: { contains: query, mode: "insensitive" } },
    select: { name: true, discordUserId: true },
    orderBy: { name: "asc" },
    take: 10,
  });
  await prisma.$disconnect();

  if (!matches.length) throw new Error(`No ALIVE character matching "${query}".`);
  if (matches.length > 1) {
    const names = matches.map((c) => `  ${c.name}`).join("\n");
    throw new Error(`"${query}" matches ${matches.length} characters:\n${names}`);
  }
  return { discordUserId: matches[0].discordUserId, label: matches[0].name };
}

export async function resolveTarget(argv, env = loadEnv()) {
  const gmIndex = argv.indexOf("--gm");
  if (gmIndex !== -1) {
    // Which superadmin to mint for. The first listed one is not necessarily a
    // member of THIS environment's guild (a throwaway dev guild has only the
    // developer), and a superadmin who fails the isGm() REST check bounces
    // off /gm/turns exactly like a player — which made dev:check read as
    // failing on routes that were fine. DEV_SUPERADMIN_ID picks a different
    // one; it must still be on the superadmin.js list, so this stays a
    // selector, never a door.
    const ids = superadminIds();
    const wanted = process.env.DEV_SUPERADMIN_ID;
    if (wanted && !ids.includes(wanted)) {
      throw new Error(`DEV_SUPERADMIN_ID ${wanted} is not in web/lib/superadmin.js`);
    }
    const id = wanted || ids[0];
    return { discordUserId: id, label: `superadmin ${id}` };
  }

  const charIndex = argv.indexOf("--character");
  if (charIndex !== -1) {
    const query = argv[charIndex + 1];
    if (!query || query.startsWith("--")) {
      throw new Error('--character needs a name, e.g. --character "Jorren"');
    }
    return characterDiscordId(query, env);
  }

  const snowflake = argv.find((a) => /^\d{17,20}$/.test(a));
  if (snowflake) return { discordUserId: snowflake, label: `discord user ${snowflake}` };

  throw new Error(
    "Specify who to sign in as: --gm, --character \"<name>\", or a raw Discord user ID.",
  );
}

export async function mintCookie(discordUserId, { maxAge = DEFAULT_MAX_AGE, env = loadEnv() } = {}) {
  const secret = authSecret(env);
  const now = Math.floor(Date.now() / 1000);

  // Mirrors what web/lib/auth.js's jwt callback writes and its session callback
  // reads back. `discordUserId` is the only custom field the app consults
  // anywhere; `sub` is Auth.js's own convention.
  const token = {
    discordUserId,
    sub: discordUserId,
    iat: now,
    exp: now + maxAge,
    jti: crypto.randomUUID(),
  };

  const jwt = await encode({ token, secret, salt: COOKIE_NAME, maxAge });

  // A wrong secret or salt yields a token the app rejects as an anonymous
  // request — which looks like an ordinary auth redirect much later, far from
  // the cause. Fail here instead.
  const roundTrip = await decode({ token: jwt, secret, salt: COOKIE_NAME });
  if (roundTrip?.discordUserId !== discordUserId) {
    throw new Error("Minted token failed to decode — AUTH_SECRET or salt is wrong.");
  }

  return `${COOKIE_NAME}=${jwt}`;
}

async function main() {
  const env = loadEnv();
  const { discordUserId } = await resolveTarget(process.argv.slice(2), env);
  // stdout carries the cookie and nothing else, so it can be captured directly:
  //   COOKIE=$(node scripts/dev/session.mjs --gm)
  process.stdout.write(await mintCookie(discordUserId, { env }) + "\n");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
