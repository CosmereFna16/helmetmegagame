// docs/locations.yaml -> DB + Discord, shared by db/prisma/sync-locations.js
// (manual `npm run db:sync-locations`) and wipeGameData's "Restart Game" flow
// (web/app/(app)/gm/dev/actions.js) — see the "Zones, Locations, and
// character roles" section of root CLAUDE.md. docs/locations.yaml is the
// sole creation path for Zone/Location rows; this function is upsert-only
// and never deletes/deprovisions anything, so a removed YAML entry just
// leaves its existing DB row and Discord channels in place.
//
// Two passes:
//   1. DB upsert: for each YAML entry, upsert its Zone (matched by name —
//      Zone has no slug, a known fragility left for the upcoming location
//      redesign) and its Location (matched by slug, falling back to a
//      name+zone match for legacy pre-slug rows). Only name/tags/zoneId are
//      ever written — discord*Id fields are untouched.
//   2. Discord provisioning: any Location still missing discordCategoryId
//      gets its category + 3 channels created (same layout as the GM Panel's
//      "Provision Discord channels" button). Already-provisioned locations
//      are never touched.
const fs = require("node:fs");
const path = require("node:path");
const yaml = require("js-yaml");
const { createChannel, getGuildChannels, patchGuildChannelPositions } = require("./discordRest");

const CHANNEL_TYPE_TEXT = 0;
const CHANNEL_TYPE_CATEGORY = 4;
const CHANNEL_TYPE_FORUM = 15;

const PERM_VIEW_CHANNEL = 1024;
const PERM_SEND_MESSAGES = 2048;
const PERM_CREATE_PUBLIC_THREADS = 34359738368;
const PERM_CREATE_PRIVATE_THREADS = 68719476736;

async function provisionLocationChannels(prisma, location) {
  const guildId = process.env.DISCORD_GUILD_ID;
  const gmRoleId = process.env.DISCORD_GM_ROLE_ID;

  const category = await createChannel({
    name: `${location.zone.name} / ${location.name}`,
    type: CHANNEL_TYPE_CATEGORY,
    permission_overwrites: [
      { id: guildId, type: 0, deny: String(PERM_VIEW_CHANNEL) },
      ...(gmRoleId ? [{ id: gmRoleId, type: 0, allow: String(PERM_VIEW_CHANNEL) }] : []),
    ],
  });
  const plainChannel = await createChannel({
    name: location.name,
    type: CHANNEL_TYPE_TEXT,
    parent_id: category.id,
    rate_limit_per_user: 60,
  });
  const publicChannel = await createChannel({
    name: `${location.name}-public`,
    type: CHANNEL_TYPE_FORUM,
    parent_id: category.id,
    default_auto_archive_duration: 1440,
    available_tags: [{ name: "Persistent", emoji_name: "⏰" }],
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

async function syncLocationsFromYaml(prisma) {
  const yamlPath = path.join(__dirname, "..", "..", "docs", "locations.yaml");
  const doc = yaml.load(fs.readFileSync(yamlPath, "utf8"));
  const entries = doc?.locations ?? [];

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

    let location = await prisma.location.findUnique({ where: { slug: entry.id } });
    if (!location) {
      // Fall back to matching a pre-existing, pre-slug row by name+zone so
      // this doesn't create a duplicate for locations seeded before slug
      // existed — it just claims the slug onto that row instead.
      location = await prisma.location.findFirst({ where: { name: entry.name, zoneId: zone.id } });
    }

    if (!location) {
      location = await prisma.location.create({
        data: { slug: entry.id, name: entry.name, zoneId: zone.id, tags },
      });
      locationsCreated += 1;
    } else {
      const needsUpdate =
        location.slug !== entry.id ||
        location.name !== entry.name ||
        location.zoneId !== zone.id ||
        JSON.stringify(location.tags) !== JSON.stringify(tags);
      if (needsUpdate) {
        location = await prisma.location.update({
          where: { id: location.id },
          data: { slug: entry.id, name: entry.name, zoneId: zone.id, tags },
        });
        locationsUpdated += 1;
      }
    }
    location.zone = zone;
    upserted.push(location);
  }

  const unprovisioned = upserted.filter((l) => !l.discordCategoryId);
  for (const location of unprovisioned) {
    await provisionLocationChannels(prisma, location);
  }
  if (unprovisioned.length > 0) {
    await sortLocationCategories(prisma);
  }

  return {
    zonesCreated,
    locationsCreated,
    locationsUpdated,
    provisioned: unprovisioned.map((l) => l.name),
  };
}

module.exports = { syncLocationsFromYaml };
