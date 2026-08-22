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
//      2. Discord provisioning + reconciliation: any Location still missing
//      discordCategoryId gets its category + 3 channels created, from the
//      layout described by locationChannelSpec below. Every Location that
//      already had channels then has two things reconciled against that same
//      spec: its plain (summary) channel topic, rewritten to
//      `{description} | **Sublocations**: {publicSubLocations}`, and its
//      permission overwrites, re-applied one target at a time. Both are
//      derived rather than hand-authored, so edits to the YAML (or a
//      half-applied provisioning run) keep propagating — unlike the
//      category/channel *names*, which are never touched post-provisioning
//      (see CLAUDE.md).
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
  putChannelOverwrite,
  deleteChannelOverwrite,
  getChannel,
} = require("./discordRest");
const { spectatorOverwrite } = require("./spectatorAccess");
const { SPECTATOR_ROLE_ID } = require("./roleIds");
const { PERSISTENT_TAG_NAME, PERSISTENT_EMOJI } = require("./persistence");

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

// The complete intended Discord layout for one Location: the category and its
// three channels, as create payloads minus `parent_id` (which only exists once
// the category has been made).
//
// This is deliberately the SINGLE description of that layout — both
// provisionLocationChannels (on first create) and applyLocationPermissions
// (on every later re-sync) build from it, so the two can never disagree.
function locationChannelSpec(location) {
  const guildId = process.env.DISCORD_GUILD_ID;
  const gmRoleId = process.env.DISCORD_GM_ROLE_ID;

  return {
    category: {
      name: `${location.zone.name} / ${location.name}`,
      type: CHANNEL_TYPE_CATEGORY,
      permission_overwrites: [
        // ATTACH_FILES deny lives here rather than per-channel because none of
        // the three channels below set their own overwrite for that bit, so
        // they all inherit this category-level deny. GMs get an explicit
        // category-level allow for the same reason: their per-channel
        // overwrites (GM_PLAIN_PERMS etc.) don't mention ATTACH_FILES either,
        // so they'd otherwise inherit the deny too.
        //
        // The VIEW_CHANNEL half of this deny is the entire mechanism that
        // makes a Location private — every other overwrite in this file is an
        // allow layered back on top of it.
        { id: guildId, type: 0, deny: String(PERM_VIEW_CHANNEL + PERM_ATTACH_FILES) },
        ...(gmRoleId ? [{ id: gmRoleId, type: 0, allow: String(PERM_VIEW_CHANNEL + PERM_ATTACH_FILES) }] : []),
        // Read-only observer seat; all three channels inherit it from here.
        ...spectatorOverwrite(),
      ],
    },
    plain: {
      name: location.name,
      type: CHANNEL_TYPE_TEXT,
      rate_limit_per_user: 60,
      topic: buildSummaryTopic(location) ?? undefined,
      permission_overwrites: gmChannelOverwrite(gmRoleId, GM_PLAIN_PERMS),
    },
    public: {
      name: `${location.name}-public`,
      type: CHANNEL_TYPE_FORUM,
      default_auto_archive_duration: 1440,
      available_tags: [{ name: PERSISTENT_TAG_NAME, emoji_name: PERSISTENT_EMOJI }],
      permission_overwrites: gmChannelOverwrite(gmRoleId, GM_PUBLIC_PERMS),
    },
    private: {
      name: `${location.name}-private`,
      type: CHANNEL_TYPE_TEXT,
      permission_overwrites: [
        {
          id: guildId,
          type: 0,
          deny: String(PERM_VIEW_CHANNEL + PERM_SEND_MESSAGES + PERM_CREATE_PUBLIC_THREADS),
          allow: String(PERM_CREATE_PRIVATE_THREADS),
        },
        ...gmChannelOverwrite(gmRoleId, GM_PRIVATE_PERMS),
      ],
    },
  };
}

async function provisionLocationChannels(prisma, location) {
  const spec = locationChannelSpec(location);

  const category = await createChannel(spec.category);
  const plainChannel = await createChannel({ ...spec.plain, parent_id: category.id });
  const publicChannel = await createChannel({ ...spec.public, parent_id: category.id });
  const privateChannel = await createChannel({ ...spec.private, parent_id: category.id });

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

// The three overwrite targets this sync owns. Everything else on a Location's
// channels belongs to somebody else — above all the one ViewChannel overwrite
// per character currently standing in the category
// (bot/src/lib/location.js#swapLocationAccess) — and must never be touched
// here. Membership in this set is what makes the delete pass below safe.
function managedOverwriteIds() {
  return new Set(
    [process.env.DISCORD_GUILD_ID, process.env.DISCORD_GM_ROLE_ID, SPECTATOR_ROLE_ID].filter(Boolean),
  );
}

// Reconciles one channel's overwrites against the spec: PUT everything the
// spec names, then DELETE any *managed* target the spec no longer names.
//
// Still one request per target, never a PATCH of the whole
// permission_overwrites array — a wholesale replace would evict every
// character's per-location ViewChannel grant and lock the guild out of the
// rooms they're standing in.
//
// The delete half is what makes this a reconcile rather than an append. A PUT
// can create or replace a named target but can never remove one, so before
// this the sync was structurally incapable of undoing an overwrite that
// shouldn't exist. That is exactly how Caverns, Aberrant Pits and Railroad
// stayed world-visible through repeated clean re-syncs: the plain and -public
// channels name only the GM role in the spec, so a channel-level @everyone
// ViewChannel allow left behind by a half-finished provisioning run beat the
// category's deny — the one overwrite the whole privacy model rests on — and
// nothing in the codebase could reach it.
async function reconcileChannelOverwrites(channelId, want) {
  const wanted = new Map(want.permission_overwrites.map((o) => [o.id, o]));
  const changes = [];

  for (const overwrite of wanted.values()) {
    await putChannelOverwrite(channelId, overwrite.id, {
      allow: overwrite.allow ?? "0",
      deny: overwrite.deny ?? "0",
      type: overwrite.type,
    });
  }

  // Reading the live channel is the only way to see an overwrite the spec
  // doesn't mention. allow404 isn't available on getChannel, so a stale
  // recorded id throws here rather than silently skipping — which is the
  // right trade: a channel id pointing at nothing is a real problem worth
  // failing the sync over, and the caller reports which Location it was.
  const live = await getChannel(channelId);
  const managed = managedOverwriteIds();

  for (const existing of live?.permission_overwrites ?? []) {
    if (wanted.has(existing.id)) continue;
    if (!managed.has(existing.id)) continue;
    await deleteChannelOverwrite(channelId, existing.id);
    changes.push(existing.id);
  }

  return changes;
}

// Re-applies locationChannelSpec's overwrites to an already-provisioned
// Location, so a category whose permissions were never applied (a partially
// failed provisioning run) or were edited by hand in Discord is brought back
// in line by an ordinary re-sync.
//
// Returns a list of human-readable descriptions of anything it had to remove,
// so the script can say what it repaired. A sync that fixes fifteen Locations
// and one that fixes none used to print the identical summary, which is most
// of why this bug looked like "the sync did nothing".
async function applyLocationPermissions(location) {
  const spec = locationChannelSpec(location);
  const targets = [
    ["category", location.discordCategoryId, spec.category],
    [location.name, location.discordChannelId, spec.plain],
    [`${location.name}-public`, location.discordPublicChannelId, spec.public],
    [`${location.name}-private`, location.discordPrivateChannelId, spec.private],
  ];

  const repairs = [];
  for (const [label, channelId, want] of targets) {
    if (!channelId) continue;
    const removed = await reconcileChannelOverwrites(channelId, want);
    for (const id of removed) {
      repairs.push(`${location.name} (${label}): removed stray overwrite for ${id}`);
    }
  }
  return repairs;
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
  // Zip sorted Locations onto the position slots those categories already
  // held, so non-Location categories keep their places. Guard the pairing:
  // a category id recorded in the DB but missing from the guild shortens
  // currentPositions, and a `position: undefined` in the payload is dropped
  // by JSON.stringify into a malformed PATCH that aborts the whole sync.
  const updates = sorted
    .map((l, i) => ({ id: l.discordCategoryId, position: currentPositions[i] }))
    .filter((u) => Number.isInteger(u.position));

  if (updates.length > 0) await patchGuildChannelPositions(updates);
}

// Orders each Location's three channels within its category: summary, then
// -public, then -private.
//
// This has to be stated explicitly. Nothing ever sent a `position` for a child
// channel, and CHANNELS.md's claim that creation order is display order was
// simply wrong — freshly created siblings collide on position and Discord
// breaks the tie by snowflake, which is why the forum was surfacing above the
// summary channel. Positions are also editable by hand in Discord, so this
// belongs in the every-run pass rather than at creation time.
//
// One PATCH for the whole guild: the endpoint takes any mix of channels and
// interprets each position relative to its siblings under the same parent, so
// the cost is a single request no matter how many Locations there are.
// parent_id is asserted alongside, which also pulls back a channel that
// drifted out of its category.
async function sortLocationChannels(prisma) {
  const locations = await prisma.location.findMany({
    where: { discordCategoryId: { not: null } },
  });

  const updates = [];
  for (const location of locations) {
    const ordered = [
      location.discordChannelId,
      location.discordPublicChannelId,
      location.discordPrivateChannelId,
    ];
    ordered.forEach((id, position) => {
      if (!id) return;
      updates.push({ id, position, parent_id: location.discordCategoryId });
    });
  }

  if (updates.length === 0) return 0;
  await patchGuildChannelPositions(updates);
  return updates.length;
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
    // provisionLocationChannels returns the row carrying the four new Discord
    // ids. Copy them back onto the in-memory object: `upserted` was read
    // before provisioning, and the reconciliation pass below keys off these
    // columns. Discarding the return value meant a freshly provisioned
    // Location could still look unprovisioned to that pass — or worse, be
    // reconciled against the stale ids it had beforehand.
    const provisioned = await provisionLocationChannels(prisma, location);
    Object.assign(location, {
      discordCategoryId: provisioned.discordCategoryId,
      discordChannelId: provisioned.discordChannelId,
      discordPublicChannelId: provisioned.discordPublicChannelId,
      discordPrivateChannelId: provisioned.discordPrivateChannelId,
      justProvisioned: true,
    });
  }
  if (unprovisioned.length > 0) {
    await sortLocationCategories(prisma);
  }

  // Reconciliation pass over Locations that already had channels before this
  // run. Two things deliberately stay in sync post-provisioning, unlike the
  // category/channel *names*, which are never touched again:
  //
  //   - the summary channel's topic, which is cosmetic content edited in the
  //     YAML rather than the channel's identity;
  //   - the permission overwrites, which are derived entirely from
  //     locationChannelSpec and the env — never hand-authored, so there is no
  //     hand-edit to preserve (/gm/dev/zones was removed precisely because
  //     Locations aren't edited by hand mid-game). Without this, a Location
  //     provisioned during a partially-failed run stays world-visible forever
  //     with nothing in the codebase able to repair it.
  //
  // Freshly provisioned Locations are excluded — provisionLocationChannels
  // set both the topic and every overwrite at create time, and re-doing it
  // would be ~12 redundant Discord calls each on a path (wipeGameData's
  // Restart Game) that provisions every Location at once. That exclusion is
  // now an explicit flag rather than an inference from a null column: keying
  // it off `discordChannelId` while the provisioning filter keyed off
  // `discordCategoryId` left a gap where a row with a category but no channel
  // id matched neither filter and was skipped in total silence.
  const preexisting = upserted.filter((l) => l.discordCategoryId && !l.justProvisioned);
  const permissionRepairs = [];
  for (const location of preexisting) {
    // allow404: a recorded channel id pointing at a channel someone deleted by
    // hand used to throw here and abort the entire run, leaving every later
    // Location in the YAML untouched — with the failure looking like an
    // unrelated 404 rather than "your DB and Discord disagree".
    if (location.discordChannelId) {
      await patchChannel(location.discordChannelId, { topic: buildSummaryTopic(location) ?? "" });
    }
    permissionRepairs.push(...(await applyLocationPermissions(location)));
  }

  // Channel order is reconciled for every Location, provisioned this run or
  // not — see sortLocationChannels. One PATCH, unconditionally.
  const channelsOrdered = await sortLocationChannels(prisma);

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
    reconciled: preexisting.length,
    permissionRepairs,
    channelsOrdered,
    pruned: stale.map((l) => l.name),
    zonesPruned: staleZones.map((z) => z.name),
  };
}

module.exports = { syncLocationsFromYaml };
