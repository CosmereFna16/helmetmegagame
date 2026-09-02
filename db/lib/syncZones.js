// docs/zones.yaml -> DB + Discord, used by `npm run db:sync-zones` and
// wipeGameData's "Restart Game" flow. docs/zones.yaml is the sole source of
// truth for the Zone / Location / Room roster: this reconciles DB + Discord
// to match it, upserting entries present in the YAML and destructively
// removing anything no longer listed. Five passes: parse+validate, DB
// upsert, Discord provisioning (create-only), reconcile (every run), prune.
const fs = require("node:fs");
const yaml = require("js-yaml");
const {
  createChannel,
  deleteChannel,
  getGuildChannels,
  getGuildRoles,
  createGuildRole,
  deleteGuildRole,
  patchChannel,
  patchGuildChannelPositions,
  putChannelOverwrite,
  deleteChannelOverwrite,
  getChannel,
  startThread,
  startPrivateThread,
  patchThread,
  deleteThread,
  editMessage,
  postMessage,
  clearMessagesExcept,
  chunkMessage,
  pinMessage,
  fetchActiveThreads,
  listActiveThreadsForChannel,
  listArchivedPublicThreads,
  listArchivedPrivateThreads,
} = require("./discordRest");
const crypto = require("node:crypto");
const { SPECTATOR_ROLE_ID } = require("./roleIds");
const { cursedRoleId, ensureCursedRoleAppearance } = require("./cursedAccess");
const { docsPath } = require("./repoPaths");
const {
  zoneChannelSpec,
  locationChannelSpec,
  zoneRoleName,
  locationRoleName,
} = require("./zoneChannelSpec");
const { syncTurnsChannelAccess } = require("./turnsChannelAccess");
const { locationAnchorRow } = require("./locationAnchorRow");
const { entriesOf } = require("./yamlEntries");

const CHANNEL_TYPE_CATEGORY = 4;

const KIND_BY_YAML = { surface: "SURFACE", group: "CAVE_GROUP" };

// Cave levels share one category, so their location channels interleave
// there: level.sortOrder * this + location.sortOrder.
const LEVEL_CHANNEL_STRIDE = 10;

// docsPath() is null only when docs/ cannot be found at all — fatal for a
// YAML master, since it would otherwise read as "everything was deleted".
function requireDocsPath(...segments) {
  const p = docsPath(...segments);
  if (!p) throw new Error(`Cannot find docs/${segments.join("/")} — see db/lib/repoPaths.js`);
  return p;
}

function hashBody(body) {
  return crypto.createHash("sha256").update(body).digest("hex").slice(0, 32);
}

// --- Pass 0: parse + validate ------------------------------------------

// Flattens the YAML into zone, location and room entries plus the location
// graph. Throws on anything structurally wrong; a bad master must fail
// before the first write.
function parseZonesYaml(doc) {
  const zoneEntries = [];
  const locationEntries = [];
  const roomEntries = [];
  const problems = [];
  const warnings = [];

  for (const [index, zone] of entriesOf(doc?.zones, "id").entries()) {
    if (!zone?.id) {
      problems.push(`zones[${index}] has no id`);
      continue;
    }
    const kind = KIND_BY_YAML[zone.kind ?? "surface"];
    if (!kind) {
      problems.push(`zone "${zone.id}" has unknown kind "${zone.kind}"`);
      continue;
    }

    zoneEntries.push({
      slug: zone.id,
      name: zone.name ?? zone.id,
      kind,
      sortOrder: zone.sort ?? index + 1,
      description: zone.description ?? "",
      parentSlug: null,
      mapPolygon: zone.map?.polygon ?? null,
      mapLabelX: zone.map?.label?.x ?? null,
      mapLabelY: zone.map?.label?.y ?? null,
    });

    if (kind === "CAVE_GROUP") {
      if (entriesOf(zone.locations, "id").length > 0) {
        problems.push(`group zone "${zone.id}" carries locations — they belong on its levels`);
      }
      for (const [levelIndex, level] of entriesOf(zone.levels, "id").entries()) {
        if (!level?.id) {
          problems.push(`zone "${zone.id}" levels[${levelIndex}] has no id`);
          continue;
        }
        zoneEntries.push({
          slug: level.id,
          name: level.name ?? level.id,
          kind: "CAVE_LEVEL",
          sortOrder: levelIndex + 1,
          description: level.description ?? "",
          parentSlug: zone.id,
          mapPolygon: level.map?.polygon ?? null,
          mapLabelX: level.map?.label?.x ?? null,
          mapLabelY: level.map?.label?.y ?? null,
        });
        collectLocations(level, level.id, locationEntries, roomEntries, problems);
      }
    } else {
      if (entriesOf(zone.levels, "id").length > 0) {
        problems.push(`zone "${zone.id}" carries levels but is not kind: group`);
      }
      collectLocations(zone, zone.id, locationEntries, roomEntries, problems);
    }
  }

  // Zone, location and room slugs share one namespace.
  const seen = new Set();
  for (const entry of [...zoneEntries, ...locationEntries, ...roomEntries]) {
    if (seen.has(entry.slug)) problems.push(`duplicate slug "${entry.slug}"`);
    seen.add(entry.slug);
  }

  // A presence zone with no location is a zone nobody can stand in.
  for (const zone of zoneEntries) {
    if (zone.kind === "CAVE_GROUP") continue;
    if (!locationEntries.some((l) => l.zoneSlug === zone.slug)) {
      problems.push(`zone "${zone.slug}" has no locations — a character has nowhere to stand`);
    }
  }

  // connections: pairs of "zone/location".
  const locationByRef = new Map(locationEntries.map((l) => [`${l.zoneSlug}/${l.slug}`, l]));
  const connections = [];
  for (const pair of doc?.connections ?? []) {
    if (!Array.isArray(pair) || pair.length !== 2) {
      problems.push(`connections entry ${JSON.stringify(pair)} is not a pair`);
      continue;
    }
    const resolved = pair.map((ref) => {
      const location = locationByRef.get(String(ref));
      if (!location) problems.push(`connections references unknown location "${ref}" (want zone/location)`);
      return location?.slug ?? null;
    });
    if (resolved.every(Boolean)) connections.push(resolved);
  }

  // A location with no road is legal but almost always a typo.
  const connected = new Set(connections.flat());
  for (const location of locationEntries) {
    if (!connected.has(location.slug)) {
      warnings.push(`location "${location.zoneSlug}/${location.slug}" appears in no connections entry — it is unreachable`);
    }
  }

  if (problems.length > 0) {
    throw new Error(`docs/zones.yaml is invalid:\n  - ${problems.join("\n  - ")}`);
  }
  return { zoneEntries, locationEntries, roomEntries, connections, warnings };
}

function collectLocations(zone, zoneSlug, locationEntries, roomEntries, problems) {
  for (const [index, location] of entriesOf(zone.locations, "id").entries()) {
    if (!location?.id) {
      problems.push(`zone "${zoneSlug}" locations[${index}] has no id`);
      continue;
    }
    locationEntries.push({
      slug: location.id,
      name: location.name ?? location.id,
      description: location.description ?? "",
      sortOrder: index,
      zoneSlug,
    });
    for (const [roomIndex, room] of entriesOf(location.rooms, "id").entries()) {
      if (!room?.id) {
        problems.push(`location "${location.id}" rooms[${roomIndex}] has no id`);
        continue;
      }
      const access = Array.isArray(room.access) ? room.access.map(String).filter(Boolean) : [];
      if (room.access != null && !Array.isArray(room.access)) {
        problems.push(`room "${room.id}" has a non-list access:`);
      }
      roomEntries.push({
        slug: room.id,
        name: room.name ?? room.id,
        description: room.description ?? "",
        sortOrder: roomIndex,
        kind: access.length > 0 ? "PRIVATE" : "PUBLIC",
        accessTagSlugs: access,
        locationSlug: location.id,
      });
    }
  }
}

// The overwrite targets this sync may DELETE. @everyone is deliberately NOT
// in the set: its ViewChannel deny is the overwrite the whole privacy model
// rests on, so no future spec edit can strip a channel's privacy here.
function managedOverwriteIds(roleIds) {
  return new Set(
    [process.env.DISCORD_GM_ROLE_ID, SPECTATOR_ROLE_ID, cursedRoleId(), ...roleIds].filter(Boolean),
  );
}

// Reconciles one channel's overwrites against the spec: PUT everything the
// spec names, then DELETE any managed target it no longer names. One request
// per target, never a wholesale PATCH, which would evict grants this sync
// doesn't own (narrowcast).
async function reconcileChannelOverwrites(channelId, want, managed) {
  const wanted = new Map(want.permission_overwrites.map((o) => [o.id, o]));
  const changes = [];

  for (const overwrite of wanted.values()) {
    await putChannelOverwrite(channelId, overwrite.id, {
      allow: overwrite.allow ?? "0",
      deny: overwrite.deny ?? "0",
      type: overwrite.type,
    });
  }

  // allow404 deliberately NOT passed: a recorded channel id pointing at
  // nothing is worth failing this target over.
  const live = await getChannel(channelId);
  for (const existing of live?.permission_overwrites ?? []) {
    if (wanted.has(existing.id)) continue;
    if (!managed.has(existing.id)) continue;
    await deleteChannelOverwrite(channelId, existing.id);
    changes.push(existing.id);
  }

  return changes;
}

// --- Bodies ------------------------------------------------------------

function italicParagraphs(text) {
  // Italic markup doesn't survive a blank line, so each paragraph wraps on
  // its own.
  return (text || "")
    .trim()
    .split(/\n{2,}/)
    .filter(Boolean)
    .map((paragraph) => `*${paragraph.trim()}*`)
    .join("\n\n");
}

function buildRoomBody(room) {
  const parts = [`**${room.name}**`];
  const description = italicParagraphs(room.description);
  if (description) parts.push(description);
  return parts.join("\n\n");
}

// The pinned anchor: name, -# description, and the Public Rooms index as
// thread mentions. Private rooms are deliberately absent — they're what the
// Secret rooms? button is for.
function buildAnchorBody(location, rooms) {
  const parts = [`**${location.name}**`];
  const description = (location.description || "").trim();
  if (description) {
    parts.push(
      description
        .split(/\n{2,}/)
        .map((paragraph) => `-# ${paragraph.trim().replace(/\s*\n+\s*/g, " ")}`)
        .join("\n"),
    );
  }
  const publicRooms = rooms
    .filter((r) => r.kind === "PUBLIC" && r.discordThreadId)
    .sort((a, b) => a.sortOrder - b.sortOrder);
  parts.push(
    publicRooms.length > 0
      ? `**Public Rooms**: ${publicRooms.map((r) => `<#${r.discordThreadId}>`).join(" | ")}`
      : "**Public Rooms**: none ‡",
  );
  return parts.join("\n\n");
}

// --- Room threads ------------------------------------------------------

// Finds a thread already under the channel with this exact title, so
// syncRoomThread can adopt it instead of creating a duplicate (a retried
// create Discord already applied).
async function findExistingThread(channelId, title, snapshot, kind) {
  const active = await listActiveThreadsForChannel(channelId, snapshot);
  const found = active.find((t) => t.name === title);
  if (found) return found;
  const archived =
    kind === "PRIVATE"
      ? await listArchivedPrivateThreads(channelId)
      : await listArchivedPublicThreads(channelId);
  return archived.find((t) => t.name === title) ?? null;
}

// Writes a room's starter into a thread that has none recorded: first chunk
// becomes the starter (pinned in-thread), the rest follow.
async function writeRoomStarter(threadId, chunks) {
  const starter = await postMessage(threadId, chunks[0]);
  for (const chunk of chunks.slice(1)) await postMessage(threadId, chunk);
  // Best-effort: a pin failure must never abort the sync.
  await pinMessage(threadId, starter.id).catch((err) =>
    console.error(`Room starter pin failed (${threadId}):`, err.message),
  );
  return starter.id;
}

// One thread per room under its location's channel, sync-owned: starter =
// the room body, reconciled by hash. Never locked (players roleplay inside
// it); the Dawn wipe clears replies but never the starter. Returns
// "created" | "updated" | "unchanged" | "skipped".
async function syncRoomThread(prisma, room, location, snapshot) {
  if (!location?.discordChannelId) return "skipped";

  const body = buildRoomBody(room);
  const hash = hashBody(body);
  const chunks = chunkMessage(body);
  const title = room.name.slice(0, 100);

  let existing = null;
  if (room.discordThreadId) {
    existing = await getChannel(room.discordThreadId, { allow404: true });
  }
  if (existing && room.starterMessageId && room.postHash === hash) {
    // The cheap re-assert that keeps a room visible after seven idle days.
    if (existing.thread_metadata?.archived) await patchThread(room.discordThreadId, { archived: false });
    return "unchanged";
  }

  if (!existing) {
    const adopted = await findExistingThread(location.discordChannelId, title, snapshot, room.kind);
    let thread = adopted;
    if (!thread) {
      thread =
        room.kind === "PRIVATE"
          ? await startPrivateThread(location.discordChannelId, title, 10080)
          : await startThread(location.discordChannelId, title, 10080);
    } else {
      await patchThread(thread.id, { archived: false });
      await clearMessagesExcept(thread.id, null);
    }
    const starterMessageId = await writeRoomStarter(thread.id, chunks);
    await prisma.room.update({
      where: { id: room.id },
      data: { discordThreadId: thread.id, starterMessageId, postHash: hash },
    });
    room.discordThreadId = thread.id;
    room.starterMessageId = starterMessageId;
    room.postHash = hash;
    return adopted ? "updated" : "created";
  }

  // Rewrite in place: unarchive, drop everything but the starter, edit it.
  await patchThread(room.discordThreadId, { archived: false });
  let starterMessageId = room.starterMessageId;
  if (starterMessageId) {
    await clearMessagesExcept(room.discordThreadId, starterMessageId);
    try {
      await editMessage(room.discordThreadId, starterMessageId, chunks[0]);
      for (const chunk of chunks.slice(1)) await postMessage(room.discordThreadId, chunk);
    } catch (err) {
      if (err?.status !== 404) throw err;
      starterMessageId = null;
    }
  }
  if (!starterMessageId) {
    await clearMessagesExcept(room.discordThreadId, null);
    starterMessageId = await writeRoomStarter(room.discordThreadId, chunks);
  }
  await patchThread(room.discordThreadId, { name: title, archived: false });
  await prisma.room.update({
    where: { id: room.id },
    data: { starterMessageId, postHash: hash },
  });
  room.starterMessageId = starterMessageId;
  room.postHash = hash;
  return "updated";
}

// The pinned anchor message in a location's channel. Hash-gated on body +
// components; a message a GM deleted by hand is reposted.
async function syncLocationAnchor(prisma, location, rooms) {
  if (!location.discordChannelId) return "skipped";

  const body = buildAnchorBody(location, rooms);
  const components = [locationAnchorRow(location.id)];
  const hash = hashBody(`${body} ${JSON.stringify(components)}`);

  if (location.anchorMessageId && location.anchorHash === hash) return "unchanged";

  if (location.anchorMessageId) {
    try {
      await editMessage(location.discordChannelId, location.anchorMessageId, body, components);
      await prisma.location.update({ where: { id: location.id }, data: { anchorHash: hash } });
      location.anchorHash = hash;
      return "updated";
    } catch (err) {
      if (err?.status !== 404) throw err;
      // Fall through and repost.
    }
  }

  const message = await postMessage(location.discordChannelId, body, components);
  await pinMessage(location.discordChannelId, message.id).catch((err) =>
    console.error(`Anchor pin failed for ${location.slug}:`, err.message),
  );
  await prisma.location.update({
    where: { id: location.id },
    data: { anchorMessageId: message.id, anchorHash: hash },
  });
  location.anchorMessageId = message.id;
  location.anchorHash = hash;
  return "created";
}

// --- Ordering ----------------------------------------------------------

async function sortZoneCategories(prisma) {
  const zones = await prisma.zone.findMany({ where: { discordCategoryId: { not: null } } });
  if (zones.length === 0) return;

  const channels = await getGuildChannels();
  const categoryIds = new Set(zones.map((z) => z.discordCategoryId));
  const currentPositions = channels
    .filter((c) => c.type === CHANNEL_TYPE_CATEGORY && categoryIds.has(c.id))
    .map((c) => c.position)
    .sort((a, b) => a - b);

  const sorted = [...zones].sort(
    (a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name),
  );
  const updates = sorted
    .map((z, i) => ({ id: z.discordCategoryId, position: currentPositions[i] }))
    .filter((u) => Number.isInteger(u.position));

  if (updates.length > 0) await patchGuildChannelPositions(updates);
}

// Per surface zone: #summary then its location channels in sortOrder, under
// the zone's category. Per cave level: its location channels under the
// group's category, offset by level. `parent_id` must NOT ride along in the
// bulk position PATCH (Discord 400 code 40009 — reparenting is one channel
// at a time), so drifted channels are repaired separately first.
async function sortZoneChannels(prisma) {
  const zones = await prisma.zone.findMany({
    orderBy: { sortOrder: "asc" },
    include: { locations: { orderBy: { sortOrder: "asc" } } },
  });

  const intended = [];
  for (const zone of zones) {
    if (zone.kind === "SURFACE") {
      let position = 0;
      if (zone.discordSummaryChannelId) {
        intended.push({ id: zone.discordSummaryChannelId, position: position++, parentId: zone.discordCategoryId });
      }
      for (const location of zone.locations) {
        if (location.discordChannelId) {
          intended.push({ id: location.discordChannelId, position: position++, parentId: zone.discordCategoryId });
        }
      }
    } else if (zone.kind === "CAVE_LEVEL") {
      const parent = zones.find((z) => z.id === zone.parentZoneId);
      zone.locations.forEach((location, offset) => {
        if (location.discordChannelId) {
          intended.push({
            id: location.discordChannelId,
            position: zone.sortOrder * LEVEL_CHANNEL_STRIDE + offset,
            parentId: parent?.discordCategoryId ?? null,
          });
        }
      });
    }
  }
  if (intended.length === 0) return { ordered: 0, reparented: [] };

  const live = new Map((await getGuildChannels()).map((c) => [c.id, c]));
  const reparented = [];
  for (const { id, parentId } of intended) {
    const current = live.get(id);
    if (!current || !parentId || current.parent_id === parentId) continue;
    await patchChannel(id, { parent_id: parentId });
    reparented.push(id);
  }

  await patchGuildChannelPositions(intended.map(({ id, position }) => ({ id, position })));
  return { ordered: intended.length, reparented };
}

// --- The sync ----------------------------------------------------------

async function ensureRole(name, liveRoles) {
  const role = await createGuildRole({
    name,
    permissions: "0",
    color: 0,
    hoist: false,
    mentionable: false,
  });
  liveRoles.add(role.id);
  return role;
}

async function syncZonesFromYaml(prisma) {
  const yamlPath = requireDocsPath("zones.yaml");
  const doc = yaml.load(fs.readFileSync(yamlPath, "utf8"));
  const { zoneEntries, locationEntries, roomEntries, connections, warnings } = parseZonesYaml(doc);
  for (const warning of warnings) console.warn(`zones.yaml: ${warning}`);

  const report = {
    warnings,
    zonesCreated: 0,
    zonesUpdated: 0,
    locationsCreated: 0,
    locationsUpdated: 0,
    locationsMoved: [],
    roomsMoved: [],
    rolesCreated: [],
    provisioned: [],
    reconciled: 0,
    permissionRepairs: [],
    rooms: { created: 0, updated: 0, unchanged: 0, skipped: 0 },
    anchors: { created: 0, updated: 0, unchanged: 0, skipped: 0 },
    channelsOrdered: 0,
    channelsReparented: [],
    pruned: [],
    locationsPruned: [],
    roomsPruned: [],
    turnsAccess: null,
  };

  // Pass 1a: upsert zones by slug, parents before children.
  const ordered = [...zoneEntries].sort(
    (a, b) => (a.parentSlug ? 1 : 0) - (b.parentSlug ? 1 : 0),
  );
  const zonesBySlug = new Map();
  for (const entry of ordered) {
    const parent = entry.parentSlug ? zonesBySlug.get(entry.parentSlug) : null;
    if (entry.parentSlug && !parent) {
      throw new Error(`zone "${entry.slug}" names unknown parent "${entry.parentSlug}"`);
    }
    const data = {
      name: entry.name,
      kind: entry.kind,
      sortOrder: entry.sortOrder,
      description: entry.description,
      parentZoneId: parent?.id ?? null,
      mapPolygon: entry.mapPolygon ?? undefined,
      mapLabelX: entry.mapLabelX,
      mapLabelY: entry.mapLabelY,
    };

    let zone = await prisma.zone.findUnique({ where: { slug: entry.slug } });
    if (!zone) {
      zone = await prisma.zone.create({ data: { ...data, slug: entry.slug } });
      report.zonesCreated += 1;
    } else {
      zone = await prisma.zone.update({ where: { id: zone.id }, data: { ...data, slug: entry.slug } });
      report.zonesUpdated += 1;
    }
    zonesBySlug.set(entry.slug, zone);
  }
  const zoneById = new Map([...zonesBySlug.values()].map((z) => [z.id, z]));

  // Pass 1b: seatZoneId — parentZoneId ?? id, now that every id exists.
  for (const zone of zonesBySlug.values()) {
    const seatZoneId = zone.parentZoneId ?? zone.id;
    if (zone.seatZoneId !== seatZoneId) {
      await prisma.zone.update({ where: { id: zone.id }, data: { seatZoneId } });
      zone.seatZoneId = seatZoneId;
    }
  }

  // Pass 1c: locations, matched by slug. A location whose zone changed
  // keeps its channel and role — a text channel CAN be reparented, which the
  // ordering pass does once the category is known.
  const locationsBySlug = new Map();
  for (const entry of locationEntries) {
    const zone = zonesBySlug.get(entry.zoneSlug);
    const data = {
      name: entry.name,
      description: entry.description,
      sortOrder: entry.sortOrder,
      zoneId: zone.id,
    };
    let location = await prisma.location.findUnique({ where: { slug: entry.slug } });
    if (!location) {
      location = await prisma.location.create({ data: { ...data, slug: entry.slug } });
      report.locationsCreated += 1;
    } else {
      if (location.zoneId !== zone.id) report.locationsMoved.push(entry.slug);
      location = await prisma.location.update({ where: { id: location.id }, data });
      report.locationsUpdated += 1;
    }
    locationsBySlug.set(entry.slug, location);
  }

  // Pass 1c-bis: rooms, matched by slug. A thread can't change parents, so a
  // room whose location changed is deleted and recreated by the room pass.
  const roomsBySlug = new Map();
  for (const entry of roomEntries) {
    const location = locationsBySlug.get(entry.locationSlug);
    const data = {
      name: entry.name,
      description: entry.description,
      sortOrder: entry.sortOrder,
      kind: entry.kind,
      accessTagSlugs: entry.accessTagSlugs,
      locationId: location.id,
    };
    let room = await prisma.room.findUnique({ where: { slug: entry.slug } });
    if (!room) {
      room = await prisma.room.create({ data: { ...data, slug: entry.slug } });
    } else if ((room.locationId !== location.id || room.kind !== entry.kind) && room.discordThreadId) {
      // A kind change is a thread-type change, which Discord can't do either.
      await deleteThread(room.discordThreadId);
      report.roomsMoved.push(entry.slug);
      room = await prisma.room.update({
        where: { id: room.id },
        data: { ...data, discordThreadId: null, starterMessageId: null, postHash: null },
      });
    } else {
      room = await prisma.room.update({ where: { id: room.id }, data });
    }
    roomsBySlug.set(entry.slug, room);
  }

  // Pass 1d: the travel graph — both directions explicit.
  const neighbors = new Map();
  for (const [a, b] of connections) {
    if (!neighbors.has(a)) neighbors.set(a, new Set());
    if (!neighbors.has(b)) neighbors.set(b, new Set());
    neighbors.get(a).add(b);
    neighbors.get(b).add(a);
  }
  for (const location of locationsBySlug.values()) {
    const set = [...(neighbors.get(location.slug) ?? [])].map((slug) => ({
      id: locationsBySlug.get(slug).id,
    }));
    await prisma.location.update({ where: { id: location.id }, data: { connectsTo: { set } } });
  }

  // Pass 2a: roles — one per presence zone, one per location. Created when
  // null OR the recorded role was deleted by hand (doctor reports it, this
  // repairs it).
  const liveRoles = new Set((await getGuildRoles()).map((r) => r.id));
  for (const zone of zonesBySlug.values()) {
    if (zone.kind === "CAVE_GROUP") continue;
    if (zone.discordRoleId && liveRoles.has(zone.discordRoleId)) continue;
    const role = await ensureRole(zoneRoleName(zone), liveRoles);
    await prisma.zone.update({ where: { id: zone.id }, data: { discordRoleId: role.id } });
    zone.discordRoleId = role.id;
    report.rolesCreated.push(zoneRoleName(zone));
  }
  for (const location of locationsBySlug.values()) {
    if (location.discordRoleId && liveRoles.has(location.discordRoleId)) continue;
    const role = await ensureRole(locationRoleName(location), liveRoles);
    await prisma.location.update({ where: { id: location.id }, data: { discordRoleId: role.id } });
    location.discordRoleId = role.id;
    report.rolesCreated.push(locationRoleName(location));
  }

  // Pass 2b: categories + channels, create-only. Groups before levels.
  const provisionOrder = [...zonesBySlug.values()].sort((a, b) => {
    const rank = (z) => (z.kind === "CAVE_GROUP" ? 0 : z.kind === "SURFACE" ? 1 : 2);
    return rank(a) - rank(b) || a.sortOrder - b.sortOrder;
  });
  const categoryIdFor = (zone) =>
    zone.discordCategoryId ?? (zone.parentZoneId ? zoneById.get(zone.parentZoneId)?.discordCategoryId : null) ?? null;

  for (const zone of provisionOrder) {
    const spec = zoneChannelSpec(zone);
    const updates = {};

    if (spec.category && !zone.discordCategoryId) {
      const category = await createChannel(spec.category);
      updates.discordCategoryId = category.id;
      zone.discordCategoryId = category.id;
    }
    if (spec.summary && !zone.discordSummaryChannelId) {
      updates.discordSummaryChannelId = (
        await createChannel({ ...spec.summary, parent_id: categoryIdFor(zone) })
      ).id;
      zone.discordSummaryChannelId = updates.discordSummaryChannelId;
    }
    if (Object.keys(updates).length > 0) {
      zone.justProvisioned = true;
      await prisma.zone.update({ where: { id: zone.id }, data: updates });
      report.provisioned.push(zone.name);
    }
  }
  for (const location of [...locationsBySlug.values()].sort((a, b) => a.sortOrder - b.sortOrder)) {
    if (location.discordChannelId) continue;
    const zone = zoneById.get(location.zoneId);
    const channel = await createChannel({ ...locationChannelSpec(location), parent_id: categoryIdFor(zone) });
    await prisma.location.update({ where: { id: location.id }, data: { discordChannelId: channel.id } });
    location.discordChannelId = channel.id;
    location.justProvisioned = true;
    report.provisioned.push(`${zone.name} / ${location.name}`);
  }

  // Pass 3: reconcile everything already provisioned. Freshly provisioned
  // targets skip the overwrite reconcile but still get threads + anchors.
  const managed = managedOverwriteIds([
    ...[...zonesBySlug.values()].map((z) => z.discordRoleId),
    ...[...locationsBySlug.values()].map((l) => l.discordRoleId),
  ]);

  for (const zone of zonesBySlug.values()) {
    if (zone.justProvisioned) continue;
    const spec = zoneChannelSpec(zone);
    const targets = [
      ["category", zone.discordCategoryId, spec.category],
      ["summary", zone.discordSummaryChannelId, spec.summary],
    ];
    let reconciledAny = false;
    for (const [label, channelId, want] of targets) {
      if (!channelId || !want) continue;
      reconciledAny = true;
      if (want.type !== CHANNEL_TYPE_CATEGORY) {
        await patchChannel(channelId, {
          topic: want.topic ?? "",
          ...(want.rate_limit_per_user !== undefined
            ? { rate_limit_per_user: want.rate_limit_per_user }
            : {}),
        });
      }
      const removed = await reconcileChannelOverwrites(channelId, want, managed);
      for (const id of removed) {
        report.permissionRepairs.push(`${zone.name} (${label}): removed stray overwrite for ${id}`);
      }
    }
    if (reconciledAny) report.reconciled += 1;
  }
  for (const location of locationsBySlug.values()) {
    if (location.justProvisioned || !location.discordChannelId) continue;
    const want = locationChannelSpec(location);
    await patchChannel(location.discordChannelId, { topic: want.topic ?? "" });
    const removed = await reconcileChannelOverwrites(location.discordChannelId, want, managed);
    for (const id of removed) {
      report.permissionRepairs.push(`${location.name}: removed stray overwrite for ${id}`);
    }
    report.reconciled += 1;
  }

  await sortZoneCategories(prisma);
  const channelOrder = await sortZoneChannels(prisma);
  report.channelsOrdered = channelOrder.ordered;
  report.channelsReparented = channelOrder.reparented;

  // Room threads, then anchors — the anchor body embeds the thread ids.
  // The active-thread snapshot is fetched ONCE; it only serves adoption.
  const snapshot = await fetchActiveThreads().catch((err) => {
    console.error("sync-zones: active-thread snapshot failed, falling back to per-channel fetches:", err.message);
    return null;
  });
  const roomsByLocationId = new Map();
  for (const room of roomsBySlug.values()) {
    if (!roomsByLocationId.has(room.locationId)) roomsByLocationId.set(room.locationId, []);
    roomsByLocationId.get(room.locationId).push(room);
  }
  const locationById = new Map([...locationsBySlug.values()].map((l) => [l.id, l]));
  for (const room of roomsBySlug.values()) {
    report.rooms[await syncRoomThread(prisma, room, locationById.get(room.locationId), snapshot)] += 1;
  }
  for (const location of locationsBySlug.values()) {
    report.anchors[await syncLocationAnchor(prisma, location, roomsByLocationId.get(location.id) ?? [])] += 1;
  }

  await ensureCursedRoleAppearance().catch((err) =>
    console.warn(`cursed role appearance: ${err.message}`),
  );

  // Pass 4: prune. Rooms first (threads under location channels), then
  // locations (channel, role, row — characters standing there are set null
  // and the doctor reports them), then zones.
  const staleRooms = await prisma.room.findMany({ where: { slug: { notIn: [...roomsBySlug.keys()] } } });
  for (const room of staleRooms) {
    if (room.discordThreadId) await deleteThread(room.discordThreadId);
    await prisma.room.delete({ where: { id: room.id } });
    report.roomsPruned.push(room.name);
  }

  const staleLocations = await prisma.location.findMany({
    where: { slug: { notIn: [...locationsBySlug.keys()] } },
  });
  for (const location of staleLocations) {
    if (location.discordChannelId) await deleteChannel(location.discordChannelId);
    if (location.discordRoleId) await deleteGuildRole(location.discordRoleId);
    await prisma.location.delete({ where: { id: location.id } });
    report.locationsPruned.push(location.name);
  }

  const staleZones = await prisma.zone.findMany({ where: { slug: { notIn: [...zonesBySlug.keys()] } } });
  for (const zone of staleZones) {
    for (const id of [zone.discordSummaryChannelId, zone.discordCategoryId].filter(Boolean)) {
      await deleteChannel(id);
    }
    if (zone.discordRoleId) await deleteGuildRole(zone.discordRoleId);
    await prisma.zone.delete({ where: { id: zone.id } });
    report.pruned.push(zone.name);
  }

  // Pass 5: #turns — its view grants are keyed on zone roles, and Pass 2a
  // can recreate a role with a new id, so this repairs any stale grant.
  report.turnsAccess = await syncTurnsChannelAccess(prisma).catch((err) => {
    report.warnings.push(`#turns access sync failed: ${err.message}`);
    return null;
  });

  return report;
}

module.exports = {
  syncZonesFromYaml,
  reconcileChannelOverwrites,
  managedOverwriteIds,
  buildAnchorBody,
};
