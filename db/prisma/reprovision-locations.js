// Verifies — and, with --apply, rebuilds — a Location's Discord category and
// three channels.
//
// Why this exists, given `npm run db:sync-locations` now re-applies every
// Location's permission overwrites on each run: the sync fixes permissions
// but is blind to everything else, because it never re-reads the live
// channels. It cannot tell you that a channel is the wrong *type* (a text
// channel where the forum should be), that the plain channel lost its 60s
// slowmode, that the forum lost its Persistent tag, or that a Location's
// recorded channel ids point at something that no longer exists. Verify mode
// reads the live channels and reports all of that; --apply is the only way to
// fix the structural half, since a channel's type can't be patched.
//
// Both modes read the intended layout from
// db/lib/syncLocations.js#locationChannelSpec — the same function
// provisionLocationChannels builds from — so a verify pass can never disagree
// with what provisioning would actually do.
//
//   node db/prisma/reprovision-locations.js
//       Verify every provisioned Location. Read-only, changes nothing.
//
//   node db/prisma/reprovision-locations.js --apply <slug> [<slug>...]
//       DESTRUCTIVE. Deletes each named Location's category + 3 channels
//       (losing their messages) and recreates them through the normal
//       provisioning path, then restores the per-character access that
//       deleting the category threw away.
//
// Note when reading results by eye in Discord instead: the guild owner
// bypasses every permission overwrite, so a correctly locked category still
// looks world-visible to them (docs/systemdocs/CHANNELS.md §4). Verify mode
// reads raw overwrites over REST and is immune to that.
require("dotenv").config();
const { prisma } = require("../index");
const {
  locationChannelSpec,
  provisionLocationChannels,
  deprovisionLocationChannels,
  sortLocationCategories,
} = require("../lib/syncLocations");
const { getChannel, putChannelOverwrite } = require("../lib/discordRest");

const PERM_VIEW_CHANNEL = 1024;

// Discord omits allow/deny when they're "0" and returns overwrites in
// arbitrary order, so compare as a keyed map with both halves defaulted.
function overwriteMap(overwrites = []) {
  const map = new Map();
  for (const o of overwrites) {
    map.set(String(o.id), { allow: String(o.allow ?? "0"), deny: String(o.deny ?? "0") });
  }
  return map;
}

// Per-character ViewChannel grants are added and removed continuously as
// characters travel, so they are expected extras on a category rather than
// drift. Everything else that isn't in the spec is reported.
function diffOverwrites(label, expected, actual, ignoreIds) {
  const problems = [];
  const want = overwriteMap(expected);
  const have = overwriteMap(actual);

  for (const [id, bits] of want) {
    const live = have.get(id);
    if (!live) {
      problems.push(`${label}: missing overwrite for ${id} (want allow=${bits.allow} deny=${bits.deny})`);
    } else if (live.allow !== bits.allow || live.deny !== bits.deny) {
      problems.push(
        `${label}: overwrite for ${id} is allow=${live.allow} deny=${live.deny}, want allow=${bits.allow} deny=${bits.deny}`,
      );
    }
  }
  for (const id of have.keys()) {
    if (!want.has(id) && !ignoreIds.has(id)) {
      problems.push(`${label}: unexpected overwrite for ${id}`);
    }
  }
  return problems;
}

async function verifyLocation(location, characterRoleIds) {
  const spec = locationChannelSpec(location);
  const problems = [];

  const targets = [
    ["category", location.discordCategoryId, spec.category, characterRoleIds],
    ["plain", location.discordChannelId, spec.plain, new Set()],
    ["public", location.discordPublicChannelId, spec.public, new Set()],
    ["private", location.discordPrivateChannelId, spec.private, new Set()],
  ];

  for (const [label, channelId, want, ignoreIds] of targets) {
    if (!channelId) {
      problems.push(`${label}: no id recorded on the Location row`);
      continue;
    }

    let live;
    try {
      live = await getChannel(channelId);
    } catch (err) {
      problems.push(`${label}: could not fetch ${channelId} (${err.message})`);
      continue;
    }

    if (live.type !== want.type) {
      problems.push(`${label}: type is ${live.type}, want ${want.type}`);
    }
    if (want.rate_limit_per_user !== undefined && (live.rate_limit_per_user ?? 0) !== want.rate_limit_per_user) {
      problems.push(`${label}: slowmode is ${live.rate_limit_per_user ?? 0}s, want ${want.rate_limit_per_user}s`);
    }
    for (const tag of want.available_tags ?? []) {
      if (!(live.available_tags ?? []).some((t) => t.name === tag.name)) {
        problems.push(`${label}: missing forum tag "${tag.name}"`);
      }
    }
    problems.push(...diffOverwrites(label, want.permission_overwrites, live.permission_overwrites, ignoreIds));
  }

  return problems;
}

async function verifyAll() {
  const locations = await prisma.location.findMany({
    where: { discordCategoryId: { not: null } },
    include: { zone: true },
    orderBy: { name: "asc" },
  });

  // Every ALIVE character's personal role, so a legitimate per-character
  // ViewChannel grant on a category isn't reported as an unexpected overwrite.
  const characters = await prisma.character.findMany({
    where: { status: "ALIVE", discordRoleId: { not: null } },
    select: { discordRoleId: true },
  });
  const characterRoleIds = new Set(characters.map((c) => c.discordRoleId));

  let drifted = 0;
  for (const location of locations) {
    const problems = await verifyLocation(location, characterRoleIds);
    if (problems.length === 0) {
      console.log(`OK     ${location.slug}`);
    } else {
      drifted += 1;
      console.log(`DRIFT  ${location.slug}`);
      for (const problem of problems) console.log(`         ${problem}`);
    }
  }

  console.log(`\n${locations.length} location(s) checked, ${drifted} with drift.`);
  if (drifted > 0) {
    console.log("Permission-only drift is fixed by: npm run db:sync-locations");
    console.log("Anything structural (channel type, slowmode, forum tags) needs a rebuild:");
    console.log("  node db/prisma/reprovision-locations.js --apply <slug>");
  }
  return drifted;
}

async function applyToSlugs(slugs) {
  let failed = 0;
  let rebuilt = 0;

  for (const slug of slugs) {
    const location = await prisma.location.findUnique({ where: { slug }, include: { zone: true } });
    if (!location) {
      console.error(`skip ${slug}: no Location with that slug`);
      failed += 1;
      continue;
    }

    // Deleting the category takes every per-character ViewChannel overwrite
    // with it, so capture who is standing here before it goes. Skipping this
    // is the one way this script silently locks players out of the room
    // they're in.
    const occupants = await prisma.character.findMany({
      where: { status: "ALIVE", locationId: location.id, discordRoleId: { not: null } },
      select: { name: true, discordRoleId: true },
    });

    // Per-Location try/catch rather than one around the loop: the sync's own
    // uncaught provisioning loop is exactly what strands orphan categories in
    // Discord, and a failure on one Location shouldn't skip the rest.
    try {
      await deprovisionLocationChannels(location);
      await prisma.location.update({
        where: { id: location.id },
        data: {
          discordCategoryId: null,
          discordChannelId: null,
          discordPublicChannelId: null,
          discordPrivateChannelId: null,
        },
      });

      const reprovisioned = await provisionLocationChannels(prisma, location);

      for (const occupant of occupants) {
        await putChannelOverwrite(reprovisioned.discordCategoryId, occupant.discordRoleId, {
          allow: String(PERM_VIEW_CHANNEL),
        });
      }

      rebuilt += 1;
      const restored = occupants.length === 1 ? "1 occupant" : `${occupants.length} occupants`;
      console.log(`rebuilt ${slug} (${restored} restored)`);
    } catch (err) {
      failed += 1;
      console.error(`failed ${slug}: ${err.message}`);
      console.error(
        "  Its Discord channels may be half-deleted. Check with: node db/prisma/prune-orphan-categories.js",
      );
    }
  }

  if (rebuilt > 0) await sortLocationCategories(prisma);

  console.log(`\n${rebuilt} rebuilt, ${failed} failed.`);
  return failed;
}

async function main() {
  if (!process.env.DISCORD_TOKEN || !process.env.DISCORD_GUILD_ID) {
    console.error("DISCORD_TOKEN and DISCORD_GUILD_ID must be set.");
    process.exit(1);
  }

  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const slugs = args.filter((a) => a !== "--apply");

  if (!apply) {
    if (slugs.length > 0) {
      console.error("Slugs are only meaningful with --apply. Run with no arguments to verify everything.");
      process.exit(1);
    }
    const drifted = await verifyAll();
    process.exitCode = drifted > 0 ? 1 : 0;
    return;
  }

  if (slugs.length === 0) {
    console.error("--apply needs at least one Location slug, e.g. --apply caverns railroad aberrant-pits");
    process.exit(1);
  }

  const failed = await applyToSlugs(slugs);
  process.exitCode = failed > 0 ? 1 : 0;
}

main()
  .then(() => prisma.$disconnect())
  .catch((err) => {
    console.error(err);
    prisma.$disconnect();
    process.exit(1);
  });
