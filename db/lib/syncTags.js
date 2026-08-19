// docs/tags.yaml -> DB, called by db/prisma/sync-tags.js (manual
// `npm run db:sync-tags`) and wipeGameData's "Restart Game" flow
// (web/app/(app)/gm/dev/actions.js) — see docs/systemdocs/TAGS.md.
// docs/tags.yaml is the sole creation path for TagGroup/Tag rows; this
// function is upsert-only and never deletes anything, so removing an entry
// from the YAML just leaves its existing DB row untouched (same contract as
// syncLocations.js).
//
// Four passes, since tags/groups can reference each other by slug before
// every row necessarily exists yet:
//   1. Upsert every TagGroup's scalar fields (slug/name/category/color).
//   2. Upsert every Tag's scalar fields + groupId (groups exist from pass 1).
//   3. Resolve each Tag's parentTag/requiredTag slug references now that
//      every Tag row exists.
//   4. Resolve each TagGroup's requiredTag slug reference.
// Each pass only writes when something actually changed, same
// needsUpdate-style diff check as syncLocationsFromYaml.
const fs = require("node:fs");
const path = require("node:path");
const yaml = require("js-yaml");

function loadDoc() {
  const yamlPath = path.join(__dirname, "..", "..", "docs", "tags.yaml");
  return yaml.load(fs.readFileSync(yamlPath, "utf8"));
}

async function syncTagsFromYaml(prisma) {
  const doc = loadDoc();
  // Tags/groups reference a category by its slug (a stable YAML key), but
  // Tag.category/TagGroup.category store the human-readable display name —
  // that's what CharacterSheet.js's category headings and the GM grant
  // <select> render raw, so the DB should never hold the lowercase slug.
  const categoryNameBySlug = new Map((doc?.categories ?? []).map((c) => [c.slug, c.name]));
  const groupEntries = doc?.groups ?? [];
  const tagEntries = doc?.tags ?? [];

  for (const g of groupEntries) {
    if (!categoryNameBySlug.has(g.category)) {
      throw new Error(`docs/tags.yaml: group "${g.slug}" has unknown category "${g.category}"`);
    }
  }
  for (const t of tagEntries) {
    if (!categoryNameBySlug.has(t.category)) {
      throw new Error(`docs/tags.yaml: tag "${t.slug}" has unknown category "${t.category}"`);
    }
  }

  let groupsCreated = 0;
  let groupsUpdated = 0;
  let tagsCreated = 0;
  let tagsUpdated = 0;
  let linksUpdated = 0;

  // Pass 1: TagGroup scalars.
  const groupIdBySlug = new Map();
  for (const entry of groupEntries) {
    const color = entry.color ?? null;
    const categoryName = categoryNameBySlug.get(entry.category);
    let group = await prisma.tagGroup.findUnique({ where: { slug: entry.slug } });
    if (!group) {
      group = await prisma.tagGroup.create({
        data: { slug: entry.slug, name: entry.name, category: categoryName, color },
      });
      groupsCreated += 1;
    } else {
      const needsUpdate = group.name !== entry.name || group.category !== categoryName || group.color !== color;
      if (needsUpdate) {
        group = await prisma.tagGroup.update({
          where: { id: group.id },
          data: { name: entry.name, category: categoryName, color },
        });
        groupsUpdated += 1;
      }
    }
    groupIdBySlug.set(entry.slug, group.id);
  }

  // Pass 2: Tag scalars + groupId.
  const tagIdBySlug = new Map();
  for (const entry of tagEntries) {
    const groupId = entry.group ? (groupIdBySlug.get(entry.group) ?? null) : null;
    if (entry.group && !groupId) {
      throw new Error(`docs/tags.yaml: tag "${entry.slug}" references unknown group "${entry.group}"`);
    }
    const scalars = {
      name: entry.name,
      description: entry.description ?? null,
      category: categoryNameBySlug.get(entry.category),
      pointCost: entry.pointCost ?? 0,
      visibleOnInspect: entry.visible ?? false,
      tradeable: entry.tradeable ?? false,
      purchasable: entry.purchasable ?? false,
      defaultDurationTurns: entry.durationTurns ?? null,
      groupId,
    };

    let tag = await prisma.tag.findUnique({ where: { slug: entry.slug } });
    if (!tag) {
      tag = await prisma.tag.create({ data: { slug: entry.slug, ...scalars } });
      tagsCreated += 1;
    } else {
      const needsUpdate = Object.entries(scalars).some(([key, value]) => tag[key] !== value);
      if (needsUpdate) {
        tag = await prisma.tag.update({ where: { id: tag.id }, data: scalars });
        tagsUpdated += 1;
      }
    }
    tagIdBySlug.set(entry.slug, tag.id);
  }

  // Pass 3: parentTag / requiredTag references.
  for (const entry of tagEntries) {
    const tagId = tagIdBySlug.get(entry.slug);
    const parentTagId = entry.parentTag ? (tagIdBySlug.get(entry.parentTag) ?? null) : null;
    const requiredTagId = entry.requiredTag ? (tagIdBySlug.get(entry.requiredTag) ?? null) : null;
    if (entry.parentTag && !parentTagId) {
      throw new Error(`docs/tags.yaml: tag "${entry.slug}" references unknown parentTag "${entry.parentTag}"`);
    }
    if (entry.requiredTag && !requiredTagId) {
      throw new Error(`docs/tags.yaml: tag "${entry.slug}" references unknown requiredTag "${entry.requiredTag}"`);
    }

    const current = await prisma.tag.findUnique({
      where: { id: tagId },
      select: { parentTagId: true, requiredTagId: true },
    });
    if (current.parentTagId !== parentTagId || current.requiredTagId !== requiredTagId) {
      await prisma.tag.update({ where: { id: tagId }, data: { parentTagId, requiredTagId } });
      linksUpdated += 1;
    }
  }

  // Pass 4: TagGroup.requiredTag references.
  for (const entry of groupEntries) {
    if (!entry.requiredTag) continue;
    const requiredTagId = tagIdBySlug.get(entry.requiredTag) ?? null;
    if (!requiredTagId) {
      throw new Error(`docs/tags.yaml: group "${entry.slug}" references unknown requiredTag "${entry.requiredTag}"`);
    }
    const groupId = groupIdBySlug.get(entry.slug);
    const current = await prisma.tagGroup.findUnique({ where: { id: groupId }, select: { requiredTagId: true } });
    if (current.requiredTagId !== requiredTagId) {
      await prisma.tagGroup.update({ where: { id: groupId }, data: { requiredTagId } });
      linksUpdated += 1;
    }
  }

  return { groupsCreated, groupsUpdated, tagsCreated, tagsUpdated, linksUpdated };
}

module.exports = { syncTagsFromYaml };
