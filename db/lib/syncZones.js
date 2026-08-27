// docs/zones.yaml -> DB + Discord, shared by db/prisma/sync-zones.js
// (manual `npm run db:sync-zones`) and wipeGameData's "Restart Game" flow
// (web/app/(app)/gm/dev/actions.js). docs/zones.yaml is the sole source of
// truth for the Zone roster and its Location topics: this function fully
// reconciles DB + Discord to match it, both upserting entries present in the
// YAML and destructively removing (DB row + Discord category/channels/role,
// or forum post) any Zone/topic no longer listed there.
//
// Five passes:
//   0. Parse + validate. No writes. A malformed master fails the whole run
//      before anything is touched.
//   1. DB upsert: Zones matched by slug (cave levels flattened out of the
//      group's `levels:` list), a second sweep to stamp seatZoneId once all
//      ids exist, LocationTopic rows matched by slug, and the zone
//      connection graph written both directions.
//   2. Discord provisioning: each presence zone's "Zone: {Name}" role, then
//      each zone's category/channels per zoneChannelSpec — create-only,
//      keyed on the id columns being null. Names are one-time.
//   3. Reconcile, every run, for everything already provisioned: channel
//      topics + slowmode, permission overwrites (one PUT per target, then a
//      delete pass over MANAGED strays only), forum tags, category/channel
//      ordering, the Create-a-Topic anchor posts, the #private anchor
//      messages, the generated Location topic posts (all hash-gated), and
//      the cursed role's color.
//   4. Prune: any Zone or topic whose slug left the YAML loses its Discord
//      objects and its DB row.
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
  ensureForumTag,
  getForumTagId,
  createForumPost,
  patchThread,
  editMessage,
  postMessage,
  deleteMessage,
  fetchAllMessages,
  chunkMessage,
  THREAD_FLAG_PINNED,
} = require("./discordRest");
const crypto = require("node:crypto");
const { SPECTATOR_ROLE_ID } = require("./roleIds");
const { cursedRoleId, ensureCursedRoleAppearance } = require("./cursedAccess");
const { docsPath } = require("./repoPaths");
const { PERSISTENT_TAG_NAME, LOCATION_TAG_NAME } = require("./persistence");
const { zoneChannelSpec, zoneRoleName } = require("./zoneChannelSpec");
const { createTopicRow, createPrivateRow } = require("./zoneAnchorRow");

const CHANNEL_TYPE_CATEGORY = 4;

const KIND_BY_YAML = { surface: "SURFACE", group: "CAVE_GROUP" };

// docsPath() is null only when docs/ cannot be found at all, which for a YAML
// master is fatal — a sync with no master would read as "everything was
// deleted from the file" and prune the lot. See db/lib/repoPaths.js.
function requireDocsPath(...segments) {
  const p = docsPath(...segments);
  if (!p) throw new Error(`Cannot find docs/${segments.join("/")} — see db/lib/repoPaths.js`);
  return p;
}

function hashBody(body) {
  return crypto.createHash("sha256").update(body).digest("hex").slice(0, 32);
}

function normalizeSubLocations(entries) {
  return (entries ?? [])
    .map((entry) =>
      typeof entry === "string"
        ? { name: entry, description: "" }
        : { name: entry?.name ?? "", description: entry?.description ?? "" },
    )
    .filter((entry) => entry.name);
}

// --- Pass 0: parse + validate ------------------------------------------

// Flattens the YAML into two flat lists: zone entries (surface zones, cave
// groups, cave levels — each knowing its parent slug when it has one) and
// topic entries (each knowing which zone slug owns it). Throws on anything
// structurally wrong; a bad master must fail before the first write.
function parseZonesYaml(doc) {
  const zoneEntries = [];
  const topicEntries = [];
  const problems = [];
  const warnings = [];

  for (const [index, zone] of (doc?.zones ?? []).entries()) {
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
      if ((zone.topics ?? []).length > 0) {
        problems.push(`group zone "${zone.id}" carries topics — topics belong on its levels`);
      }
      for (const [levelIndex, level] of (zone.levels ?? []).entries()) {
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
        collectTopics(level, level.id, topicEntries, problems);
      }
    } else {
      if ((zone.levels ?? []).length > 0) {
        problems.push(`zone "${zone.id}" carries levels but is not kind: group`);
      }
      collectTopics(zone, zone.id, topicEntries, problems);
    }
  }

  // Zone and topic slugs share one namespace: a topic named like a zone would
  // make "which thing is `town`?" ambiguous everywhere slugs are read.
  const seen = new Set();
  for (const entry of [...zoneEntries, ...topicEntries]) {
    if (seen.has(entry.slug)) problems.push(`duplicate slug "${entry.slug}"`);
    seen.add(entry.slug);
  }

  const bySlug = new Map(zoneEntries.map((z) => [z.slug, z]));
  const connections = doc?.zoneConnections ?? [];
  for (const pair of connections) {
    for (const slug of pair) {
      const zone = bySlug.get(slug);
      if (!zone) problems.push(`zoneConnections references unknown zone "${slug}"`);
      else if (zone.kind === "CAVE_GROUP")
        problems.push(`zoneConnections references group zone "${slug}" — a group isn't a place`);
    }
  }

  // A presence zone with no road is unreachable — legal (a starting zone
  // could in principle be one-way) but almost always a typo, so it warns.
  const connected = new Set(connections.flat());
  for (const zone of zoneEntries) {
    if (zone.kind !== "CAVE_GROUP" && !connected.has(zone.slug)) {
      warnings.push(`zone "${zone.slug}" appears in no zoneConnections entry — it is unreachable`);
    }
  }

  if (problems.length > 0) {
    throw new Error(`docs/zones.yaml is invalid:\n  - ${problems.join("\n  - ")}`);
  }
  return { zoneEntries, topicEntries, connections, warnings };
}

function collectTopics(zone, zoneSlug, topicEntries, problems) {
  for (const [index, topic] of (zone.topics ?? []).entries()) {
    if (!topic?.id) {
      problems.push(`zone "${zoneSlug}" topics[${index}] has no id`);
      continue;
    }
    topicEntries.push({
      slug: topic.id,
      name: topic.name ?? topic.id,
      description: topic.description ?? "",
      subLocations: normalizeSubLocations(topic.subLocations),
      sortOrder: index,
      zoneSlug,
    });
  }
}

// --- Overwrite reconciliation ------------------------------------------

// The overwrite targets this sync may DELETE. Everything else on a zone
// channel belongs to somebody else and must never be touched here. The zone
// roles are all in the set — that is what makes a stray "Zone: Fortress"
// overwrite on a Town channel self-heal — but @everyone is deliberately NOT:
// its ViewChannel deny is the single overwrite the entire privacy model rests
// on, and excluding it structurally means no future edit to the spec can turn
// this pass into the thing that strips a zone's privacy.
function managedOverwriteIds(zoneRoleIds) {
  return new Set(
    [process.env.DISCORD_GM_ROLE_ID, SPECTATOR_ROLE_ID, cursedRoleId(), ...zoneRoleIds].filter(
      Boolean,
    ),
  );
}

// Reconciles one channel's overwrites against the spec: PUT everything the
// spec names, then DELETE any *managed* target the spec no longer names.
// Still one request per target, never a PATCH of the whole array — a
// wholesale replace would evict overwrites this sync doesn't own (the
// narrowcast member grants, on the special channels this is also used for).
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
  // nothing is a real problem worth failing this zone over, and the caller
  // reports which zone it was.
  const live = await getChannel(channelId);
  for (const existing of live?.permission_overwrites ?? []) {
    if (wanted.has(existing.id)) continue;
    if (!managed.has(existing.id)) continue;
    await deleteChannelOverwrite(channelId, existing.id);
    changes.push(existing.id);
  }

  return changes;
}

// --- Anchor + topic post bodies ----------------------------------------

// The one message in the pinned, locked "Create a Topic" post: the zone's
// blurb, then the instructions. The button row rides on the same message.
function buildCreateTopicBody(zone) {
  const parts = [`## ${zone.name}`];
  const description = (zone.description || "").trim();
  if (description) parts.push(description);
  parts.push(
    "Use this channel to create new roleplay locations or scenes. Use /persistent to toggle whether your topic gets wiped or not.",
  );
  return parts.join("\n\n");
}

const PRIVATE_ANCHOR_BODY =
  "Use this channel to roleplay privately. Use /add <character> and /remove <character> to invite people to your thread.";

// The starter message of a generated Location topic: the location's prose,
// then one section per sub-location. A sub-location with no text still gets
// its heading — the post is a skeleton, and the bare heading is the prompt.
function buildTopicBody(topic) {
  const parts = [`## ${topic.name}`];
  const description = (topic.description || "").trim();
  if (description) parts.push(description);
  for (const sub of normalizeSubLocations(topic.subLocations)) {
    const text = (sub.description || "").trim();
    parts.push(text ? `### ${sub.name}\n${text}` : `### ${sub.name}`);
  }
  return parts.join("\n\n");
}

// Rebuilds a generated forum post in place: everything except the starter
// message (whose id IS the thread id) is deleted, the starter is edited, and
// the full intended thread state is re-asserted. Shared by the anchor posts
// and the Location topics — the same hard-won sequence the old description
// posts used: unlock first (a locked thread rejects edits from everyone,
// ManageThreads or not), lock last (never briefly reply-able mid-rebuild).
async function rewriteForumPost(threadId, { name, chunks, appliedTags, locked, components }) {
  await patchThread(threadId, { locked: false, archived: false });

  const messages = await fetchAllMessages(threadId);
  for (const message of messages) {
    if (message.id === threadId) continue;
    await deleteMessage(threadId, message.id);
  }

  await editMessage(threadId, threadId, chunks[0], components);
  for (const chunk of chunks.slice(1)) await postMessage(threadId, chunk);

  await patchThread(threadId, {
    name,
    locked,
    archived: false,
    ...(locked ? { flags: THREAD_FLAG_PINNED } : {}),
    applied_tags: appliedTags,
  });
}

// The pinned, locked "Create a Topic" post at the top of a zone's forum.
// Location-tagged so the wipe skips it outright; hash-gated so a no-op
// re-sync costs one ensureForumTag read and nothing else.
// Returns "created" | "updated" | "unchanged" | "skipped".
async function syncCreateTopicPost(prisma, zone) {
  if (!zone.discordPublicChannelId) return "skipped";

  const locationTagId = await ensureForumTag(zone.discordPublicChannelId, LOCATION_TAG_NAME, null);
  const appliedTags = locationTagId ? [locationTagId] : [];
  const body = buildCreateTopicBody(zone);
  const hash = hashBody(body);
  const chunks = chunkMessage(body);
  const components = [createTopicRow(zone.id)];

  let existing = null;
  if (zone.createTopicThreadId) {
    existing = await getChannel(zone.createTopicThreadId, { allow404: true });
  }
  if (existing && zone.createTopicHash === hash) return "unchanged";

  if (!existing) {
    const thread = await createForumPost(zone.discordPublicChannelId, {
      name: "Create a Topic",
      content: chunks[0],
      appliedTags,
      components,
    });
    for (const chunk of chunks.slice(1)) await postMessage(thread.id, chunk);
    await patchThread(thread.id, {
      locked: true,
      archived: false,
      flags: THREAD_FLAG_PINNED,
      applied_tags: appliedTags,
    });
    await prisma.zone.update({
      where: { id: zone.id },
      data: { createTopicThreadId: thread.id, createTopicHash: hash },
    });
    zone.createTopicThreadId = thread.id;
    zone.createTopicHash = hash;
    return "created";
  }

  await rewriteForumPost(zone.createTopicThreadId, {
    name: "Create a Topic",
    chunks,
    appliedTags,
    locked: true,
    components,
  });
  await prisma.zone.update({ where: { id: zone.id }, data: { createTopicHash: hash } });
  zone.createTopicHash = hash;
  return "updated";
}

// The permanent message in a surface zone's #private, carrying the Create
// button. Hash-gated like the posts; a message a GM deleted by hand is
// reposted (editMessage 404s, and the catch below reposts).
async function syncPrivateAnchor(prisma, zone) {
  if (!zone.discordPrivateChannelId) return "skipped";

  const hash = hashBody(PRIVATE_ANCHOR_BODY);
  const components = [createPrivateRow(zone.id)];

  if (zone.privateAnchorMessageId && zone.privateAnchorHash === hash) return "unchanged";

  if (zone.privateAnchorMessageId) {
    try {
      await editMessage(zone.discordPrivateChannelId, zone.privateAnchorMessageId, PRIVATE_ANCHOR_BODY, components);
      await prisma.zone.update({ where: { id: zone.id }, data: { privateAnchorHash: hash } });
      zone.privateAnchorHash = hash;
      return "updated";
    } catch (err) {
      if (err?.status !== 404) throw err;
      // Fall through and repost.
    }
  }

  const message = await postMessage(zone.discordPrivateChannelId, PRIVATE_ANCHOR_BODY, components);
  await prisma.zone.update({
    where: { id: zone.id },
    data: { privateAnchorMessageId: message.id, privateAnchorHash: hash },
  });
  zone.privateAnchorMessageId = message.id;
  zone.privateAnchorHash = hash;
  return "created";
}

// One generated, Location-tagged, UNLOCKED, unpinned forum post per topic.
// Players roleplay inside it — that is the point of the rework — so it is
// never locked; the Dawn wipe clears its replies but never its starter.
// Not pinned: Discord caps pinned posts per forum, and the Location tag is
// the discoverability mechanism instead. Only the Create-a-Topic anchor pins.
async function syncTopicPost(prisma, topic, zone) {
  if (!zone?.discordPublicChannelId) return "skipped";

  const locationTagId = await getForumTagId(zone.discordPublicChannelId, LOCATION_TAG_NAME);
  const appliedTags = locationTagId ? [locationTagId] : [];
  const body = buildTopicBody(topic);
  const hash = hashBody(body);
  const chunks = chunkMessage(body);
  const title = topic.name.slice(0, 100);

  let existing = null;
  if (topic.discordThreadId) {
    existing = await getChannel(topic.discordThreadId, { allow404: true });
  }
  if (existing && topic.postHash === hash) return "unchanged";

  if (!existing) {
    const thread = await createForumPost(zone.discordPublicChannelId, {
      name: title,
      content: chunks[0],
      appliedTags,
    });
    for (const chunk of chunks.slice(1)) await postMessage(thread.id, chunk);
    await patchThread(thread.id, { archived: false, applied_tags: appliedTags });
    await prisma.locationTopic.update({
      where: { id: topic.id },
      data: { discordThreadId: thread.id, postHash: hash },
    });
    topic.discordThreadId = thread.id;
    topic.postHash = hash;
    return "created";
  }

  await rewriteForumPost(topic.discordThreadId, {
    name: title,
    chunks,
    appliedTags,
    locked: false,
  });
  await prisma.locationTopic.update({ where: { id: topic.id }, data: { postHash: hash } });
  topic.postHash = hash;
  return "updated";
}

// --- Ordering ----------------------------------------------------------

// Zone categories in YAML order (sortOrder, then name), zipped onto the
// position slots those categories already hold so non-zone categories keep
// their places.
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

// Channels within each category: summary, public, private for a surface
// zone; cave-level forums in level order under the group's category. One
// bulk position PATCH; `parent_id` must NOT ride along in it (Discord 400
// code 40009 — reparenting is one channel at a time), so drifted channels
// are repaired separately first.
async function sortZoneChannels(prisma) {
  const zones = await prisma.zone.findMany({ orderBy: { sortOrder: "asc" } });

  const intended = [];
  for (const zone of zones) {
    if (zone.kind === "SURFACE") {
      [zone.discordSummaryChannelId, zone.discordPublicChannelId, zone.discordPrivateChannelId]
        .forEach((id, position) => {
          if (id) intended.push({ id, position, parentId: zone.discordCategoryId });
        });
    } else if (zone.kind === "CAVE_LEVEL" && zone.discordPublicChannelId) {
      const parent = zones.find((z) => z.id === zone.parentZoneId);
      intended.push({
        id: zone.discordPublicChannelId,
        position: zone.sortOrder,
        parentId: parent?.discordCategoryId ?? null,
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

async function syncZonesFromYaml(prisma) {
  const yamlPath = requireDocsPath("zones.yaml");
  const doc = yaml.load(fs.readFileSync(yamlPath, "utf8"));
  const { zoneEntries, topicEntries, connections, warnings } = parseZonesYaml(doc);
  for (const warning of warnings) console.warn(`zones.yaml: ${warning}`);

  const report = {
    warnings,
    zonesCreated: 0,
    zonesUpdated: 0,
    rolesCreated: [],
    provisioned: [],
    reconciled: 0,
    permissionRepairs: [],
    anchors: { created: 0, updated: 0, unchanged: 0, skipped: 0 },
    privateAnchors: { created: 0, updated: 0, unchanged: 0, skipped: 0 },
    topics: { created: 0, updated: 0, unchanged: 0, skipped: 0, moved: [] },
    channelsOrdered: 0,
    channelsReparented: [],
    pruned: [],
    topicsPruned: [],
  };

  // Pass 1a: upsert zones by slug. Parents before children, so parentZoneId
  // can resolve in one sweep.
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
      // Claim a pre-slug row by name (the migration slugs existing rows from
      // their names, so this only fires for a hand-made row).
      zone = await prisma.zone.findFirst({ where: { name: entry.name, slug: null } });
    }
    if (!zone) {
      zone = await prisma.zone.create({ data: { ...data, slug: entry.slug } });
      report.zonesCreated += 1;
    } else {
      zone = await prisma.zone.update({ where: { id: zone.id }, data: { ...data, slug: entry.slug } });
      report.zonesUpdated += 1;
    }
    zonesBySlug.set(entry.slug, zone);
  }

  // Pass 1b: seatZoneId — parentZoneId ?? id, now that every id exists.
  for (const zone of zonesBySlug.values()) {
    const seatZoneId = zone.parentZoneId ?? zone.id;
    if (zone.seatZoneId !== seatZoneId) {
      await prisma.zone.update({ where: { id: zone.id }, data: { seatZoneId } });
      zone.seatZoneId = seatZoneId;
    }
  }

  // Pass 1c: topics, matched by slug. A topic whose zone changed moves: its
  // old post is deleted (a forum post cannot change forums) and the null'd
  // ids make the post pass below recreate it in the new forum.
  const topicsBySlug = new Map();
  for (const entry of topicEntries) {
    const zone = zonesBySlug.get(entry.zoneSlug);
    const data = {
      name: entry.name,
      description: entry.description,
      subLocations: entry.subLocations,
      sortOrder: entry.sortOrder,
      zoneId: zone.id,
    };

    let topic = await prisma.locationTopic.findUnique({ where: { slug: entry.slug } });
    if (!topic) {
      topic = await prisma.locationTopic.create({ data: { ...data, slug: entry.slug } });
    } else {
      if (topic.zoneId !== zone.id && topic.discordThreadId) {
        await deleteChannel(topic.discordThreadId);
        report.topics.moved.push(entry.slug);
        topic = await prisma.locationTopic.update({
          where: { id: topic.id },
          data: { ...data, discordThreadId: null, postHash: null },
        });
      } else {
        topic = await prisma.locationTopic.update({ where: { id: topic.id }, data });
      }
    }
    topicsBySlug.set(entry.slug, topic);
  }

  // Pass 1d: the travel graph — each zone's full neighbor set, both
  // directions explicitly, so only connectsTo is ever read.
  const neighbors = new Map();
  for (const [a, b] of connections) {
    if (!neighbors.has(a)) neighbors.set(a, new Set());
    if (!neighbors.has(b)) neighbors.set(b, new Set());
    neighbors.get(a).add(b);
    neighbors.get(b).add(a);
  }
  for (const zone of zonesBySlug.values()) {
    const set = [...(neighbors.get(zone.slug) ?? [])].map((slug) => ({
      id: zonesBySlug.get(slug).id,
    }));
    await prisma.zone.update({ where: { id: zone.id }, data: { connectsTo: { set } } });
  }

  // Pass 2a: zone roles for presence zones — create when the column is null
  // OR the recorded role no longer exists in the guild (someone deleted it
  // by hand; the doctor reports that, this repairs it).
  const liveRoles = new Set((await getGuildRoles()).map((r) => r.id));
  for (const zone of zonesBySlug.values()) {
    if (zone.kind === "CAVE_GROUP") continue;
    if (zone.discordRoleId && liveRoles.has(zone.discordRoleId)) continue;
    const role = await createGuildRole({
      name: zoneRoleName(zone),
      permissions: "0",
      color: 0,
      hoist: false,
      mentionable: false,
    });
    await prisma.zone.update({ where: { id: zone.id }, data: { discordRoleId: role.id } });
    zone.discordRoleId = role.id;
    report.rolesCreated.push(zoneRoleName(zone));
  }

  // Pass 2b: categories + channels, create-only. Groups before levels so a
  // level can parent onto its group's category.
  const provisionOrder = [...zonesBySlug.values()].sort((a, b) => {
    const rank = (z) => (z.kind === "CAVE_GROUP" ? 0 : z.kind === "SURFACE" ? 1 : 2);
    return rank(a) - rank(b) || a.sortOrder - b.sortOrder;
  });

  for (const zone of provisionOrder) {
    const spec = zoneChannelSpec(zone);
    const updates = {};
    let touched = false;

    if (spec.category && !zone.discordCategoryId) {
      const category = await createChannel(spec.category);
      updates.discordCategoryId = category.id;
      touched = true;
    }
    const parent = zone.parentZoneId
      ? [...zonesBySlug.values()].find((z) => z.id === zone.parentZoneId)
      : null;
    const categoryId =
      updates.discordCategoryId ?? zone.discordCategoryId ?? parent?.discordCategoryId ?? null;

    if (spec.summary && !zone.discordSummaryChannelId) {
      updates.discordSummaryChannelId = (
        await createChannel({ ...spec.summary, parent_id: categoryId })
      ).id;
      touched = true;
    }
    if (spec.public && !zone.discordPublicChannelId) {
      updates.discordPublicChannelId = (
        await createChannel({ ...spec.public, parent_id: categoryId })
      ).id;
      touched = true;
    }
    if (spec.private && !zone.discordPrivateChannelId) {
      updates.discordPrivateChannelId = (
        await createChannel({ ...spec.private, parent_id: categoryId })
      ).id;
      touched = true;
    }

    if (touched) {
      Object.assign(zone, updates);
      zone.justProvisioned = true;
      await prisma.zone.update({ where: { id: zone.id }, data: updates });
      report.provisioned.push(zone.name);
    }
  }

  // Pass 3: reconcile everything already provisioned. Freshly provisioned
  // zones skip the overwrite/topic reconcile (creation just applied the
  // spec) but still get their anchors and posts, which provisioning never
  // creates.
  const zoneRoleIds = [...zonesBySlug.values()].map((z) => z.discordRoleId).filter(Boolean);
  const managed = managedOverwriteIds(zoneRoleIds);

  for (const zone of zonesBySlug.values()) {
    if (zone.justProvisioned) continue;
    const spec = zoneChannelSpec(zone);
    const targets = [
      ["category", zone.discordCategoryId, spec.category],
      ["summary", zone.discordSummaryChannelId, spec.summary],
      ["public", zone.discordPublicChannelId, spec.public],
      ["private", zone.discordPrivateChannelId, spec.private],
    ];
    let reconciledAny = false;
    for (const [label, channelId, want] of targets) {
      if (!channelId || !want) continue;
      reconciledAny = true;
      // Topic + slowmode are cosmetic content, re-asserted from the spec.
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
      // Forum tags — the only route by which an already-provisioned forum
      // gains one; idempotent on a fresh forum.
      if (want.available_tags) {
        await ensureForumTag(channelId, PERSISTENT_TAG_NAME, null);
        await ensureForumTag(channelId, LOCATION_TAG_NAME, null);
      }
    }
    if (reconciledAny) report.reconciled += 1;
  }

  await sortZoneCategories(prisma);
  const channelOrder = await sortZoneChannels(prisma);
  report.channelsOrdered = channelOrder.ordered;
  report.channelsReparented = channelOrder.reparented;

  // Anchors + generated topic posts, hash-gated, for every zone with the
  // relevant channel — freshly provisioned zones included.
  for (const zone of zonesBySlug.values()) {
    if (zone.discordPublicChannelId) {
      report.anchors[await syncCreateTopicPost(prisma, zone)] += 1;
    }
    if (zone.discordPrivateChannelId) {
      report.privateAnchors[await syncPrivateAnchor(prisma, zone)] += 1;
    }
  }
  for (const topic of topicsBySlug.values()) {
    const zone = [...zonesBySlug.values()].find((z) => z.id === topic.zoneId);
    report.topics[await syncTopicPost(prisma, topic, zone)] += 1;
  }

  // The cursed role's color-0 pin rides on every sync — one PATCH.
  await ensureCursedRoleAppearance().catch((err) =>
    console.warn(`cursed role appearance: ${err.message}`),
  );

  // Pass 4: prune. Topics first (their posts live in zone forums), then
  // zones — Discord objects, role included, then the row (topics/threads
  // cascade).
  const topicSlugs = [...topicsBySlug.keys()];
  const staleTopics = await prisma.locationTopic.findMany({
    where: { slug: { notIn: topicSlugs } },
  });
  for (const topic of staleTopics) {
    if (topic.discordThreadId) await deleteChannel(topic.discordThreadId);
    await prisma.locationTopic.delete({ where: { id: topic.id } });
    report.topicsPruned.push(topic.name);
  }

  const zoneSlugs = [...zonesBySlug.keys()];
  const staleZones = await prisma.zone.findMany({ where: { slug: { notIn: zoneSlugs } } });
  for (const zone of staleZones) {
    const channelIds = [
      zone.discordSummaryChannelId,
      zone.discordPublicChannelId,
      zone.discordPrivateChannelId,
      zone.discordCategoryId,
    ].filter(Boolean);
    for (const id of channelIds) await deleteChannel(id);
    if (zone.discordRoleId) await deleteGuildRole(zone.discordRoleId);
    await prisma.zone.delete({ where: { id: zone.id } });
    report.pruned.push(zone.name);
  }

  return report;
}

module.exports = {
  syncZonesFromYaml,
  parseZonesYaml,
  reconcileChannelOverwrites,
  managedOverwriteIds,
  buildTopicBody,
  buildCreateTopicBody,
};
