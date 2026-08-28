// Deletes a duplicate zone provisioning: whole "Town"/"Fortress"/"Windlands"/
// "Caves" categories, their channels, and their `Zone: {Name}` roles that no
// Zone row in the database points at.
//
// How the guild ends up with two of everything: db:sync-zones only CREATES a
// channel whose id column is null (CHANNELS.md §2). So if the Zone rows lose
// their discord*Id values — a wipe, a re-seed, a restored dump — the next sync
// has nothing to adopt and provisions a second, complete set beside the first.
// That is exactly what happened on 2026-08-28: one set at 01:02 UTC, another at
// 13:31, with the DB pointing only at the later one.
//
// Nothing else in the repo reaps the loser. syncZonesFromYaml's prune pass
// walks rows that exist in the DB and have left docs/zones.yaml; it never scans
// Discord for objects that have no row at all. The channel doctor doesn't look
// for orphan categories either. Hence this one-off.
//
// The stale `Zone: {Name}` roles are the reason this matters beyond tidiness:
// a member still holding one can see the dead rooms.
//
// Dry-run by default with an --apply flag, matching db:prune-tags and
// db:prune-orphan-roles. Conservative by construction:
//   - the keep-set is read from the DB, never hardcoded;
//   - a category is only a candidate if its name is exactly a Zone.name AND
//     its id is in no Zone row, so #info, GM, Gameplay, Radio and Text
//     Channels can never be reached;
//   - a zone whose own id column is null protects every category/role of that
//     name — with nothing recorded there is no way to tell live from stale;
//   - anything holding messages is skipped and reported, and a category with a
//     skipped child is skipped with it.
require("dotenv").config();
const { prisma } = require("../index");
const { discordRequest, deleteChannel } = require("../lib/discordRest");

const CATEGORY = 4;
const FORUM = 15;
const ZONE_ROLE_PREFIX = "Zone: ";

// Every thread under a candidate forum, active and archived alike. An archived
// Location post still holds whatever was said in it.
async function forumThreads(channelId) {
  const archived = await discordRequest(
    `/channels/${channelId}/threads/archived/public?limit=100`,
    { allow404: true },
  );
  return archived?.threads ?? [];
}

// "Holds content" means content this script must not destroy — which is not
// the same as "has messages". Every provisioned channel carries at least the
// bot's own anchor post, and a Location post its sync-written starter, so a
// bare message count would veto every deletion on a guild that has never been
// spoken in.
//
// Two things distinguish real play from furniture. A proxied character line is
// a WEBHOOK message (PROXYING.md), so `webhook_id` is set and author.bot is
// useless as a test. And a thread's `message_count` excludes its starter, so a
// Location post nobody has replied in reads 0.
async function holdsContent(channel, botUserId) {
  if (typeof channel.message_count === "number" && channel.message_count > 0) return true;
  const messages = await discordRequest(`/channels/${channel.id}/messages?limit=100`, {
    allow404: true,
  });
  if (!Array.isArray(messages)) return false;
  return messages.some((m) => m.webhook_id || m.author?.id !== botUserId);
}

async function main() {
  const apply = process.argv.includes("--apply");
  const guildId = process.env.DISCORD_GUILD_ID;
  if (!guildId) throw new Error("DISCORD_GUILD_ID is not set.");

  const zones = await prisma.zone.findMany();
  const [channels, roles, activeThreads, self] = await Promise.all([
    discordRequest(`/guilds/${guildId}/channels`),
    discordRequest(`/guilds/${guildId}/roles`),
    discordRequest(`/guilds/${guildId}/threads/active`),
    discordRequest("/users/@me"),
  ]);
  const botUserId = self.id;

  const liveChannelIds = new Set();
  const liveRoleIds = new Set();
  // Names whose objects are off-limits entirely: the zone has nothing recorded,
  // so a category or role of that name might be the live one.
  const unrecordedCategoryNames = new Set();
  const unrecordedRoleNames = new Set();

  for (const zone of zones) {
    for (const id of [
      zone.discordCategoryId,
      zone.discordSummaryChannelId,
      zone.discordPublicChannelId,
      zone.discordPrivateChannelId,
    ]) {
      if (id) liveChannelIds.add(id);
    }
    if (zone.discordRoleId) liveRoleIds.add(zone.discordRoleId);
    // A cave level is a forum inside the group's category and owns no category
    // of its own, so only a zone that could have one counts as unrecorded.
    if (!zone.discordCategoryId && zone.kind !== "CAVE_LEVEL") {
      unrecordedCategoryNames.add(zone.name);
    }
    if (!zone.discordRoleId) unrecordedRoleNames.add(`${ZONE_ROLE_PREFIX}${zone.name}`);
  }

  const zoneNames = new Set(zones.map((z) => z.name));
  const skipped = [];

  const staleCategories = channels.filter(
    (c) =>
      c.type === CATEGORY &&
      zoneNames.has(c.name) &&
      !liveChannelIds.has(c.id) &&
      !unrecordedCategoryNames.has(c.name),
  );
  for (const name of unrecordedCategoryNames) {
    if (channels.some((c) => c.type === CATEGORY && c.name === name)) {
      skipped.push(`category "${name}" — the zone has no discordCategoryId recorded`);
    }
  }

  const plan = [];
  for (const category of staleCategories) {
    const children = channels.filter((c) => c.parent_id === category.id);
    const blocked = [];

    for (const child of children) {
      if (liveChannelIds.has(child.id)) {
        blocked.push(`#${child.name} is a live channel in a stale category`);
        continue;
      }
      if (await holdsContent(child, botUserId)) {
        blocked.push(`#${child.name} holds messages`);
        continue;
      }
      if (child.type !== FORUM) continue;
      const threads = [
        ...activeThreads.threads.filter((t) => t.parent_id === child.id),
        ...(await forumThreads(child.id)),
      ];
      for (const thread of threads) {
        if (await holdsContent(thread, botUserId))
          blocked.push(`"${thread.name}" in #${child.name} holds messages`);
      }
    }

    if (blocked.length) {
      skipped.push(`category "${category.name}" (${category.id}) — ${blocked.join("; ")}`);
      continue;
    }
    plan.push({ category, children });
  }

  const staleRoles = roles.filter(
    (r) =>
      r.name.startsWith(ZONE_ROLE_PREFIX) &&
      !liveRoleIds.has(r.id) &&
      !unrecordedRoleNames.has(r.name),
  );
  for (const name of unrecordedRoleNames) {
    if (roles.some((r) => r.name === name)) {
      skipped.push(`role "${name}" — the zone has no discordRoleId recorded`);
    }
  }

  const channelCount = plan.reduce((n, p) => n + p.children.length + 1, 0);
  console.log(
    `${zones.length} zone row(s); ${liveChannelIds.size} live channel id(s), ` +
      `${liveRoleIds.size} live zone role(s).\n`,
  );

  if (!channelCount && !staleRoles.length) {
    console.log("No duplicate zone categories or roles. Nothing to prune.");
    if (skipped.length) console.log(`\nSkipped:\n${skipped.map((s) => `  ! ${s}`).join("\n")}`);
    return;
  }

  console.log(`${apply ? "Deleting" : "Would delete"} ${channelCount} channel(s):`);
  for (const { category, children } of plan) {
    console.log(`  - ${category.name} (${category.id})`);
    for (const child of children) console.log(`      #${child.name} (${child.id})`);
  }
  console.log(`\n${apply ? "Deleting" : "Would delete"} ${staleRoles.length} role(s):`);
  for (const role of staleRoles) console.log(`  - ${role.name} (${role.id})`);
  if (skipped.length) console.log(`\nSkipped:\n${skipped.map((s) => `  ! ${s}`).join("\n")}`);

  if (!apply) {
    console.log("\nDry run — re-run with `-- --apply` to delete.");
    return;
  }

  // Sequential, same reasoning as db:prune-orphan-roles: this is a burst
  // against one per-guild bucket. Children before their category, so a failure
  // partway never leaves a channel orphaned at the top level.
  let deletedChannels = 0;
  for (const { category, children } of plan) {
    for (const child of [...children, category]) {
      try {
        await deleteChannel(child.id);
        deletedChannels += 1;
      } catch (err) {
        console.error(`  ! failed to delete ${child.name} (${child.id}): ${err.message}`);
      }
    }
  }

  let deletedRoles = 0;
  for (const role of staleRoles) {
    try {
      await discordRequest(`/guilds/${guildId}/roles/${role.id}`, {
        method: "DELETE",
        allow404: true,
      });
      deletedRoles += 1;
    } catch (err) {
      console.error(`  ! failed to delete ${role.name} (${role.id}): ${err.message}`);
    }
  }

  console.log(
    `\nDeleted ${deletedChannels} of ${channelCount} channel(s) and ` +
      `${deletedRoles} of ${staleRoles.length} role(s).`,
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
