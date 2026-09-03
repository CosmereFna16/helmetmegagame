// Deletes Discord categories, channels and Zone/Location roles left behind by
// a PREVIOUS game — objects no row in the database points at any more.
//
// Nothing else can do this job. db:sync-zones prunes only what it can see in
// the DB: a Zone/Location row that left docs/zones.yaml, whose Discord ids it
// still holds. An object whose DB row is already gone (a whole generation of
// channels from a game that was wiped, say) is invisible to it, and the
// channel doctor never deletes a channel at all. So a retired layout lingers
// forever, next to the live one, under a category with the same name.
//
// Dry run by default with an --apply flag, matching db:prune-tags and
// db:prune-orphan-roles.
//
// Conservative by construction — no hardcoded ids. A category is a candidate
// only when its name matches a live Zone's name AND no DB row references it,
// so a category the game never owned (Radio, GM, Text Channels) can't be one.
// Channels are only ever deleted as the children of a candidate category,
// never on their own account, and the whole run aborts if any candidate turns
// out to be referenced after all.
require("dotenv").config();
const { prisma } = require("../../index");
const { discordRequest, deleteChannel, deleteGuildRole } = require("../../lib/discordRest");

const CHANNEL_TYPE_CATEGORY = 4;

async function main() {
  const apply = process.argv.includes("--apply");
  const guildId = process.env.DISCORD_GUILD_ID;
  if (!guildId) throw new Error("DISCORD_GUILD_ID is not set.");

  const [channels, roles, zones, locations, rooms] = await Promise.all([
    discordRequest(`/guilds/${guildId}/channels`),
    discordRequest(`/guilds/${guildId}/roles`),
    prisma.zone.findMany({
      select: {
        name: true,
        discordCategoryId: true,
        discordSummaryChannelId: true,
        discordRoleId: true,
      },
    }),
    prisma.location.findMany({ select: { discordChannelId: true, discordRoleId: true } }),
    prisma.room.findMany({ select: { discordThreadId: true } }),
  ]);

  // Every Discord id the live game still owns. Membership here is an absolute
  // veto: an id in this set is never deleted, whatever else it looks like.
  const keep = new Set();
  for (const z of zones) {
    if (z.discordCategoryId) keep.add(z.discordCategoryId);
    if (z.discordSummaryChannelId) keep.add(z.discordSummaryChannelId);
  }
  for (const l of locations) if (l.discordChannelId) keep.add(l.discordChannelId);
  for (const r of rooms) if (r.discordThreadId) keep.add(r.discordThreadId);

  const zoneNames = new Set(zones.map((z) => z.name));
  const byId = new Map(channels.map((c) => [c.id, c]));

  // --- channels ---------------------------------------------------------
  const staleCategories = channels.filter(
    (c) => c.type === CHANNEL_TYPE_CATEGORY && zoneNames.has(c.name) && !keep.has(c.id),
  );
  const staleCategoryIds = new Set(staleCategories.map((c) => c.id));
  const staleChildren = channels.filter(
    (c) => c.type !== CHANNEL_TYPE_CATEGORY && c.parent_id && staleCategoryIds.has(c.parent_id),
  );

  // --- roles ------------------------------------------------------------
  // A "Zone: X" / "Location: X" role is standing infrastructure owned by
  // db:sync-zones. One the DB no longer names belongs to a retired layout;
  // deleting it strips it from every holder in a single call.
  const liveRoleIds = new Set(
    [...zones.map((z) => z.discordRoleId), ...locations.map((l) => l.discordRoleId)].filter(Boolean),
  );
  const staleRoles = roles.filter(
    (r) => /^(Zone|Location): /.test(r.name) && !liveRoleIds.has(r.id),
  );

  // --- safety gates -----------------------------------------------------
  const violations = [];
  for (const c of [...staleCategories, ...staleChildren]) {
    if (keep.has(c.id)) violations.push(`#${c.name} (${c.id}) is referenced by a live DB row`);
  }
  for (const c of staleChildren) {
    const parent = byId.get(c.parent_id);
    if (!parent || !zoneNames.has(parent.name)) {
      violations.push(`#${c.name} (${c.id}) has a parent that is not a zone category`);
    }
  }
  for (const r of staleRoles) {
    if (liveRoleIds.has(r.id)) violations.push(`role ${r.name} (${r.id}) is live`);
  }
  if (violations.length) {
    console.error("Refusing to run — the candidate set is not safe:");
    for (const v of violations) console.error(`  ! ${v}`);
    process.exitCode = 1;
    return;
  }

  // --- report -----------------------------------------------------------
  console.log(
    `Guild has ${channels.length} channel(s) and ${roles.length} role(s); the DB claims ${keep.size} channel id(s).\n`,
  );

  const total = staleCategories.length + staleChildren.length + staleRoles.length;
  if (!total) {
    console.log("No stale categories, channels or zone roles. Nothing to prune.");
    return;
  }

  const verb = apply ? "Deleting" : "Would delete";
  for (const cat of staleCategories) {
    const kids = staleChildren.filter((c) => c.parent_id === cat.id);
    console.log(`${verb} category ${cat.name} (${cat.id}) and its ${kids.length} channel(s):`);
    for (const k of kids) console.log(`    - #${k.name} (${k.id})`);
  }
  if (staleRoles.length) {
    console.log(`\n${verb} ${staleRoles.length} stale zone/location role(s):`);
    for (const r of staleRoles) console.log(`    - ${r.name} (${r.id})`);
  }

  const survivingCategories = channels.filter(
    (c) => c.type === CHANNEL_TYPE_CATEGORY && !staleCategoryIds.has(c.id),
  );
  console.log(
    `\nUntouched: ${survivingCategories.length} categor(y|ies) — ${survivingCategories.map((c) => c.name).join(", ")}`,
  );

  if (!apply) {
    console.log(`\n${total} object(s). Dry run — re-run with \`-- --apply\` to delete.`);
    return;
  }

  // Sequential on purpose: a burst of DELETEs shares one per-guild rate-limit
  // bucket, the same reason db:prune-orphan-roles doesn't parallelise.
  // Children before their category, so a failure can't orphan a channel.
  let deleted = 0;
  for (const c of [...staleChildren, ...staleCategories]) {
    try {
      await deleteChannel(c.id);
      deleted += 1;
    } catch (err) {
      console.error(`  ! failed to delete #${c.name} (${c.id}): ${err.message}`);
    }
  }
  for (const r of staleRoles) {
    try {
      await deleteGuildRole(r.id);
      deleted += 1;
    } catch (err) {
      console.error(`  ! failed to delete role ${r.name} (${r.id}): ${err.message}`);
    }
  }
  console.log(`\nDeleted ${deleted} of ${total}.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
