// docs/locations.yaml -> DB + Discord, shared by db/prisma/sync-locations.js
// (manual `npm run db:sync-locations`) and wipeGameData's "Restart Game" flow
// (web/app/(app)/gm/dev/actions.js) — see the "Zones, Locations, and
// character roles" section of root CLAUDE.md. docs/locations.yaml is the
// sole source of truth for the Zone/Location roster: this function fully
// reconciles DB + Discord to match it, both upserting entries present in the
// YAML and destructively removing (DB row + Discord category/channels) any
// Zone/Location no longer listed there.
//
// Three passes:
//   1. DB upsert: for each YAML entry, upsert its Zone (matched by name —
//      Zone has no slug, a known fragility) and its Location (matched by
//      slug, falling back to a name+zone match for legacy pre-slug rows).
//   2. Discord provisioning + topic sync: any Location still missing
//      discordCategoryId gets its category + 3 channels created (same layout
//      as the GM Panel's "Provision Discord channels" button). Every
//      Location's plain (summary) channel topic is then (re)written to
//      `{description} | **Sublocations**: {publicSubLocations}` so edits to
//      those YAML fields keep propagating even for already-provisioned
//      Locations — unlike the category/channel *names*, which are never
//      touched post-provisioning (see CLAUDE.md).
//   3. Prune: any Location whose slug isn't in the current YAML entries has
//      its Discord category+channels deleted and its DB row removed;
//      afterwards, any Zone left with zero Locations and whose name isn't in
//      the current YAML zone list is deleted too.
const fs = require("node:fs");
const path = require("node:path");
const yaml = require("js-yaml");
const {
  createChannel,
  deleteChannel,
  getGuildChannels,
  patchChannel,
  patchGuildChannelPositions,
} = require("./discordRest");
const { spectatorOverwrite } = require("./spectatorAccess");

const CHANNEL_TYPE_TEXT = 0;
const CHANNEL_TYPE_CATEGORY = 4;
const CHANNEL_TYPE_FORUM = 15;

const PERM_VIEW_CHANNEL = 1024;
const PERM_SEND_MESSAGES = 2048;
const PERM_ATTACH_FILES = 32768;
const PERM_MANAGE_MESSAGES = 8192;
const PERM_MANAGE_THREADS = 17179869184;
const PERM_CREATE_PUBLIC_THREADS = 34359738368;
const PERM_CREATE_PRIVATE_THREADS = 68719476736;
const PERM_SEND_MESSAGES_IN_THREADS = 274877906944;

// GM gets an explicit overwrite on every Location channel (not just the
// category) so it can't be silently clawed back by a channel-level
// @everyone overwrite (the -private channel sets one) — Discord resolves
// channel-level overwrites after category-level ones, so a role with no
// entry of its own at the channel falls through to whatever @everyone says
// there. Covers view/send/delete-any-message/manage-and-create-threads so a
// GM can fully moderate forum posts (-public) and private threads
// (-private) in addition to the plain channel.
function gmChannelOverwrite(gmRoleId, allow) {
  return gmRoleId ? [{ id: gmRoleId, type: 0, allow: String(allow) }] : [];
}
const GM_PLAIN_PERMS = PERM_VIEW_CHANNEL + PERM_SEND_MESSAGES + PERM_MANAGE_MESSAGES;
const GM_PUBLIC_PERMS =
  PERM_VIEW_CHANNEL + PERM_CREATE_PUBLIC_THREADS + PERM_SEND_MESSAGES_IN_THREADS + PERM_MANAGE_THREADS + PERM_MANAGE_MESSAGES;
const GM_PRIVATE_PERMS =
  PERM_VIEW_CHANNEL +
  PERM_SEND_MESSAGES +
  PERM_CREATE_PRIVATE_THREADS +
  PERM_SEND_MESSAGES_IN_THREADS +
  PERM_MANAGE_THREADS +
  PERM_MANAGE_MESSAGES;

function buildSummaryTopic(location) {
  const description = location.description || "";
  const subLocations = location.publicSubLocations ?? [];
  if (subLocations.length === 0) return description || null;
  const suffix = `**Sublocations**: ${subLocations.join(", ")}`;
  return description ? `${description} | ${suffix}` : suffix;
}

async function provisionLocationChannels(prisma, location) {
  const guildId = process.env.DISCORD_GUILD_ID;
  const gmRoleId = process.env.DISCORD_GM_ROLE_ID;

  const category = await createChannel({
    name: `${location.zone.name} / ${location.name}`,
    type: CHANNEL_TYPE_CATEGORY,
    permission_overwrites: [
      // ATTACH_FILES deny lives here rather than per-channel because none of
      // the three channels below set their own overwrite for that bit, so
      // they all inherit this category-level deny. GMs get an explicit
      // category-level allow for the same reason: their per-channel
      // overwrites (GM_PLAIN_PERMS etc.) don't mention ATTACH_FILES either,
      // so they'd otherwise inherit the deny too.
      { id: guildId, type: 0, deny: String(PERM_VIEW_CHANNEL + PERM_ATTACH_FILES) },
      ...(gmRoleId ? [{ id: gmRoleId, type: 0, allow: String(PERM_VIEW_CHANNEL + PERM_ATTACH_FILES) }] : []),
      // Read-only observer seat; all three channels inherit it from here.
      ...spectatorOverwrite(),
    ],
  });
  const plainChannel = await createChannel({
    name: location.name,
    type: CHANNEL_TYPE_TEXT,
    parent_id: category.id,
    rate_limit_per_user: 60,
    topic: buildSummaryTopic(location) ?? undefined,
    permission_overwrites: gmChannelOverwrite(gmRoleId, GM_PLAIN_PERMS),
  });
  const publicChannel = await createChannel({
    name: `${location.name}-public`,
    type: CHANNEL_TYPE_FORUM,
    parent_id: category.id,
    default_auto_archive_duration: 1440,
    available_tags: [{ name: "Persistent", emoji_name: "⏰" }],
    permission_overwrites: gmChannelOverwrite(gmRoleId, GM_PUBLIC_PERMS),
  });
  const privateChannel = await createChannel({
    name: `${location.name}-private`,
    type: CHANNEL_TYPE_TEXT,
    parent_id: category.id,
    permission_overwrites: [
      {
        id: guildId,
        type: 0,
        deny: String(PERM_VIEW_CHANNEL + PERM_SEND_MESSAGES + PERM_CREATE_PUBLIC_THREADS),
        allow: String(PERM_CREATE_PRIVATE_THREADS),
      },
      ...gmChannelOverwrite(gmRoleId, GM_PRIVATE_PERMS),
    ],
  });

  return prisma.location.update({
    where: { id: location.id },
    data: {
      discordCategoryId: category.id,
      discordChannelId: plainChannel.id,
      discordPublicChannelId: publicChannel.id,
      discordPrivateChannelId: privateChannel.id,
    },
  });
}

// Deletes a Location's Discord category + all three channels, if it was ever
// provisioned. Order doesn't matter to Discord (deleting a category doesn't
// cascade to its children), but each call is independently allow404'd so a
// partially-deprovisioned Location (e.g. a channel already removed by hand)
// doesn't block the rest.
async function deprovisionLocationChannels(location) {
  const ids = [
    location.discordChannelId,
    location.discordPublicChannelId,
    location.discordPrivateChannelId,
    location.discordCategoryId,
  ].filter(Boolean);
  for (const id of ids) {
    await deleteChannel(id);
  }
}

// Re-sorts every provisioned Location's category alphabetically by
// "{Zone} / {Location}", leaving every other category's position untouched.
async function sortLocationCategories(prisma) {
  const locations = await prisma.location.findMany({
    where: { discordCategoryId: { not: null } },
    include: { zone: true },
  });
  if (locations.length === 0) return;

  const channels = await getGuildChannels();
  const locationCategoryIds = new Set(locations.map((l) => l.discordCategoryId));
  const currentPositions = channels
    .filter((c) => c.type === CHANNEL_TYPE_CATEGORY && locationCategoryIds.has(c.id))
    .map((c) => c.position)
    .sort((a, b) => a - b);

  const sorted = [...locations].sort((a, b) =>
    `${a.zone.name} / ${a.name}`.localeCompare(`${b.zone.name} / ${b.name}`),
  );
  const updates = sorted.map((l, i) => ({ id: l.discordCategoryId, position: currentPositions[i] }));

  await patchGuildChannelPositions(updates);
}

// Every slug referenced by locationConnections must belong to a Location
// upserted this run — a typo or a slug that was removed from `locations:`
// is a data-authoring error, not something to silently ignore.
async function syncLocationConnections(prisma, upserted, connections) {
  const bySlug = new Map(upserted.map((l) => [l.slug, l]));
  for (const [a, b] of connections) {
    if (!bySlug.has(a)) throw new Error(`locationConnections references unknown location slug "${a}"`);
    if (!bySlug.has(b)) throw new Error(`locationConnections references unknown location slug "${b}"`);
  }

  const bySlugNeighbors = new Map();
  for (const [a, b] of connections) {
    if (!bySlugNeighbors.has(a)) bySlugNeighbors.set(a, new Set());
    if (!bySlugNeighbors.has(b)) bySlugNeighbors.set(b, new Set());
    bySlugNeighbors.get(a).add(b);
    bySlugNeighbors.get(b).add(a);
  }

  for (const location of upserted) {
    const neighborSlugs = [...(bySlugNeighbors.get(location.slug) ?? [])];
    const neighbors = neighborSlugs.map((slug) => ({ id: bySlug.get(slug).id }));
    await prisma.location.update({ where: { id: location.id }, data: { connectsTo: { set: neighbors } } });
  }
}

async function syncLocationsFromYaml(prisma) {
  const yamlPath = path.join(__dirname, "..", "..", "docs", "locations.yaml");
  const doc = yaml.load(fs.readFileSync(yamlPath, "utf8"));
  const entries = doc?.locations ?? [];
  const locationConnections = doc?.locationConnections ?? [];
  const entryIds = new Set(entries.map((e) => e.id));
  const entryZoneNames = new Set(entries.map((e) => e.zone));

  let zonesCreated = 0;
  let locationsCreated = 0;
  let locationsUpdated = 0;

  const zoneCache = new Map();
  async function resolveZone(name) {
    if (zoneCache.has(name)) return zoneCache.get(name);
    let zone = await prisma.zone.findFirst({ where: { name } });
    if (!zone) {
      zone = await prisma.zone.create({ data: { name } });
      zonesCreated += 1;
    }
    zoneCache.set(name, zone);
    return zone;
  }

  const upserted = [];
  for (const entry of entries) {
    const zone = await resolveZone(entry.zone);
    const tags = entry.tags ?? [];
    const description = entry.description ?? "";
    const publicSubLocations = entry.publicSubLocations ?? [];
    const privateSubLocations = entry.privateSubLocations ?? [];
    // Map panel coordinates. Optional — a location with no `map:` is simply
    // not drawn on the plate, rather than a sync failure.
    const mapX = entry.map?.x ?? null;
    const mapY = entry.map?.y ?? null;

    let location = await prisma.location.findUnique({ where: { slug: entry.id } });
    if (!location) {
      // Fall back to matching a pre-existing, pre-slug row by name+zone so
      // this doesn't create a duplicate for locations seeded before slug
      // existed — it just claims the slug onto that row instead.
      location = await prisma.location.findFirst({ where: { name: entry.name, zoneId: zone.id } });
    }

    const data = { slug: entry.id, name: entry.name, zoneId: zone.id, tags, description, publicSubLocations, privateSubLocations, mapX, mapY };

    if (!location) {
      location = await prisma.location.create({ data });
      locationsCreated += 1;
    } else {
      const needsUpdate =
        location.slug !== entry.id ||
        location.name !== entry.name ||
        location.zoneId !== zone.id ||
        location.description !== description ||
        JSON.stringify(location.tags) !== JSON.stringify(tags) ||
        JSON.stringify(location.publicSubLocations) !== JSON.stringify(publicSubLocations) ||
        JSON.stringify(location.privateSubLocations) !== JSON.stringify(privateSubLocations) ||
        location.mapX !== mapX ||
        location.mapY !== mapY;
      if (needsUpdate) {
        location = await prisma.location.update({ where: { id: location.id }, data });
        locationsUpdated += 1;
      }
    }
    location.zone = zone;
    upserted.push(location);
  }

  await syncLocationConnections(prisma, upserted, locationConnections);

  const unprovisioned = upserted.filter((l) => !l.discordCategoryId);
  for (const location of unprovisioned) {
    await provisionLocationChannels(prisma, location);
  }
  if (unprovisioned.length > 0) {
    await sortLocationCategories(prisma);
  }

  // Topic sync: keep every already-provisioned Location's summary-channel
  // topic in step with its (possibly just-edited) description/sublocations —
  // the one thing this deliberately still touches post-provisioning, since
  // it's cosmetic content rather than the channel's name/identity.
  const provisioned = upserted.filter((l) => l.discordChannelId);
  for (const location of provisioned) {
    await patchChannel(location.discordChannelId, { topic: buildSummaryTopic(location) ?? "" });
  }

  // Prune: destructively remove any Location no longer listed in the YAML.
  const stale = await prisma.location.findMany({ where: { slug: { notIn: [...entryIds] } } });
  for (const location of stale) {
    await deprovisionLocationChannels(location);
    await prisma.location.delete({ where: { id: location.id } });
  }

  // Prune empty, no-longer-referenced Zones.
  const staleZones = await prisma.zone.findMany({
    where: { name: { notIn: [...entryZoneNames] }, locations: { none: {} } },
  });
  for (const zone of staleZones) {
    await prisma.zone.delete({ where: { id: zone.id } });
  }

  return {
    zonesCreated,
    locationsCreated,
    locationsUpdated,
    provisioned: unprovisioned.map((l) => l.name),
    pruned: stale.map((l) => l.name),
    zonesPruned: staleZones.map((z) => z.name),
  };
}

module.exports = { syncLocationsFromYaml };
