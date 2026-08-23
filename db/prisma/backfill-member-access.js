// One-off migration: move every living character's Location access from a
// per-ROLE overwrite on the category alone to a per-MEMBER overwrite on the
// category and all three of its channels, and unassign the personal role from
// the player who was holding it.
//
// Run with `npm run db:backfill-member-access`. Supersedes the deleted
// db:backfill-location-access, which did the category-only, role-keyed
// version. Safe to re-run: every step is idempotent (PUT replaces, DELETE
// 404s harmlessly).
//
// Two reasons this exists, both explained in db/lib/locationAccess.js:
//
//   1. A channel does not reliably inherit its category's overwrites. Discord
//      copies them at creation and the two drift apart, so a grant written to
//      the category alone can leave a character unable to see the room they
//      are standing in.
//   2. Assigning the personal role to the player put their account in the
//      role's member list, which deanonymized the game. The role stays — it is
//      how a character is @-mentioned — but nobody holds it.
//
// Ordering, per character: ADD the member overwrites first, then DELETE the
// role one, then unassign. Add-then-delete rather than a delete pass followed
// by an add pass, so a character is never mid-run left with neither — an
// interrupted run leaves people with access, not locked out of their own room.
require("dotenv").config();
const { prisma } = require("../index");
const { putChannelOverwrite, deleteChannelOverwrite, discordRequest } = require("../lib/discordRest");
const {
  PERM_VIEW_CHANNEL,
  OVERWRITE_TYPE_MEMBER,
  locationAccessChannelIds,
} = require("../lib/locationAccess");

async function unassignRole(guildId, discordUserId, roleId) {
  return discordRequest(`/guilds/${guildId}/members/${discordUserId}/roles/${roleId}`, {
    method: "DELETE",
    allow404: true,
  });
}

async function main() {
  const guildId = process.env.DISCORD_GUILD_ID;
  if (!process.env.DISCORD_TOKEN || !guildId) {
    console.error("DISCORD_TOKEN and DISCORD_GUILD_ID must be set.");
    process.exit(1);
  }

  const characters = await prisma.character.findMany({
    where: { status: "ALIVE" },
    include: { location: true },
  });

  // Every channel of every Location, read once — the stale-role sweep below
  // needs the full set and it does not change between characters.
  const allLocations = await prisma.location.findMany({
    where: { discordCategoryId: { not: null } },
    select: {
      discordCategoryId: true,
      discordChannelId: true,
      discordPublicChannelId: true,
      discordPrivateChannelId: true,
    },
  });
  const everyChannelId = allLocations.flatMap(locationAccessChannelIds);

  let granted = 0;
  let rolesUnassigned = 0;
  const problems = [];

  for (const character of characters) {
    const channelIds = locationAccessChannelIds(character.location);

    // 1. Grant, on every channel of the room they are standing in.
    for (const channelId of channelIds) {
      try {
        await putChannelOverwrite(channelId, character.discordUserId, {
          allow: String(PERM_VIEW_CHANNEL),
          type: OVERWRITE_TYPE_MEMBER,
        });
      } catch (err) {
        problems.push(`${character.name}: grant on ${channelId} failed — ${err.message}`);
      }
    }
    if (channelIds.length > 0) granted += 1;

    // 2. Drop the old role-keyed overwrite. Swept across EVERY Location, not
    //    just the current one — the old code only ever wrote to the category
    //    of the room they were in, but a half-failed swap could have left one
    //    on a room they had left, and nothing would ever have cleaned it up.
    if (character.discordRoleId) {
      for (const channelId of everyChannelId) {
        await deleteChannelOverwrite(channelId, character.discordRoleId).catch(() => {});
      }

      // 3. Unassign the role from the player. This is the anti-deanonymization
      //    half — the role survives as a ping token held by nobody.
      try {
        await unassignRole(guildId, character.discordUserId, character.discordRoleId);
        rolesUnassigned += 1;
      } catch (err) {
        problems.push(`${character.name}: unassign failed — ${err.message}`);
      }
    }

    const where = character.location?.name ?? "nowhere";
    console.log(`${character.name} -> ${where} (${channelIds.length} channel(s))`);
  }

  console.log(`\ndone: ${characters.length} character(s) processed`);
  console.log(`  granted member access: ${granted}`);
  console.log(`  roles unassigned: ${rolesUnassigned}`);
  if (problems.length > 0) {
    console.log(`  problems (${problems.length}):`);
    for (const p of problems) console.log(`    - ${p}`);
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch((err) => {
    console.error(err);
    prisma.$disconnect();
    process.exit(1);
  });
