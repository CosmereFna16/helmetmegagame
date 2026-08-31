// docs/tags.yaml + docs/taggroups.yaml -> DB, called by db/prisma/sync-tags.js
// (manual `npm run db:sync-tags`) and wipeGameData's "Restart Game" flow
// (web/app/(app)/gm/dev/actions.js) — see docs/systemdocs/TAGS.md.
// Those two files are the sole creation path for TagGroup/Tag rows; this
// function is upsert-only and never deletes anything, so removing an entry
// from either YAML just leaves its existing DB row untouched (same contract
// as syncLocations.js).
//
// Five passes, since tags/groups can reference each other by slug before
// every row necessarily exists yet:
//   1. Upsert every TagGroup's scalar fields (slug/name/category/color).
//   2. Upsert every Tag's scalar fields + groupId (groups exist from pass 1).
//   3. Resolve each Tag's parentTag/requiredTag slug references now that
//      every Tag row exists.
//   4. Resolve each TagGroup's requiredTag slug reference.
//   5. Resolve each Tag's requirement.skills slug list (requirementSkills,
//      a many-to-many self-relation) now that every Tag row exists — same
//      reason this can't happen in pass 2, alongside pass 3/4.
// Each pass only writes when something actually changed, same
// needsUpdate-style diff check as syncLocationsFromYaml.
const fs = require("node:fs");
const yaml = require("js-yaml");
const { docsPath } = require("./repoPaths");
const {
  normalizeExpiresInto,
  validateExpiresInto,
  normalizeRemovesInto,
  validateRemovesInto,
} = require("./tagShapes");

// `visible:` in docs/tags.yaml -> Tag.inspectVisibility. The YAML side stays
// readable (`visible: worn` next to `equippable: true`) while the column is a
// real enum, so a read site that forgets the field gets undefined rather than
// a truthy "worn" — see the schema comment on inspectVisibility.
const VISIBILITY_BY_YAML = new Map([
  [true, "ALWAYS"],
  [false, "HIDDEN"],
  ["worn", "WORN"],
]);

// A consumesInto entry is a bare slug ("ate-meal"), an object carrying a
// condition and/or an expiry override ({ slug: "night-vision", unlessTags:
// ["blind"] }, { slug: "high", durationTurns: 3 }), or — added for the Caves
// Update's Skinned Cave Rat — an even random pick between alternatives
// ({ oneOf: ["ate-meal", "vomiting"] }), the same shape expiresInto already
// uses. Every shape normalises to the same quad here so validation and the
// write path only ever handle one of them. A oneOf entry's "slug" is its
// first alternative — a display fallback for anything that still reads
// consumesInto directly; the real pick lives in oneOf and is rolled by
// web/lib/consumeGrants.js.
function normalizeConsumesInto(entries) {
  return (entries ?? []).map((entry) => {
    if (typeof entry === "string") {
      return { slug: entry, unlessTags: [], durationTurns: null, oneOf: null };
    }
    if (Array.isArray(entry?.oneOf)) {
      if (entry.oneOf.length < 2) {
        throw new Error(`docs/tags.yaml: a consumesInto { oneOf: [...] } entry needs at least two alternatives`);
      }
      return { slug: entry.oneOf[0], unlessTags: [], durationTurns: null, oneOf: [...entry.oneOf] };
    }
    if (!entry?.slug) {
      throw new Error(`docs/tags.yaml: a consumesInto entry is missing its "slug"`);
    }
    const durationTurns = entry.durationTurns ?? null;
    if (durationTurns != null && !(Number.isInteger(durationTurns) && durationTurns > 0)) {
      throw new Error(
        `docs/tags.yaml: consumesInto entry "${entry.slug}" has a durationTurns that is not a positive whole number`,
      );
    }
    return { slug: entry.slug, unlessTags: entry.unlessTags ?? [], durationTurns, oneOf: null };
  });
}

// Splits the normalised list back into the four columns it's stored in.
// consumesInto keeps every target, in order, so a repeated slug still means
// "grant two" and every existing reader (the previews, the grant path) sees
// the full list. consumesIntoUnless, consumesIntoDurations and
// consumesIntoOneOf are null unless something is actually conditional,
// actually overrides its expiry, or actually picks randomly — which keeps
// all three columns empty for all but a handful of tags.
function consumesIntoScalars(entries) {
  const normalized = normalizeConsumesInto(entries);
  const unless = {};
  const durations = {};
  let anyOneOf = false;
  for (const { slug, unlessTags, durationTurns } of normalized) {
    if (unlessTags.length) unless[slug] = unlessTags;
    if (durationTurns != null) durations[slug] = durationTurns;
  }
  const oneOfList = normalized.map((e) => e.oneOf ?? null);
  if (oneOfList.some((v) => v !== null)) anyOneOf = true;
  return {
    consumesInto: normalized.map((e) => e.slug),
    consumesIntoUnless: Object.keys(unless).length ? unless : null,
    consumesIntoDurations: Object.keys(durations).length ? durations : null,
    consumesIntoOneOf: anyOneOf ? oneOfList : null,
  };
}

// normalizeExpiresInto and its three rules moved to db/lib/tagShapes.js when
// the GM tag form grew an expiry-chain picker of its own — one rule set, two
// authoring surfaces, so the form can't accept a shape this sync rejects.

// docsPath() is null only when docs/ cannot be found at all, which for a YAML
// master is fatal — a sync with no master would read as "everything was
// deleted from the file" and prune the lot. See db/lib/repoPaths.js.
function requireDocsPath(...segments) {
  const p = docsPath(...segments);
  if (!p) throw new Error(`Cannot find docs/${segments.join("/")} — see db/lib/repoPaths.js`);
  return p;
}

function loadDoc() {
  const yamlPath = requireDocsPath("tags.yaml");
  return yaml.load(fs.readFileSync(yamlPath, "utf8"));
}

function loadGroupsDoc() {
  const yamlPath = requireDocsPath("taggroups.yaml");
  return yaml.load(fs.readFileSync(yamlPath, "utf8"));
}

async function syncTagsFromYaml(prisma) {
  const doc = loadDoc();
  const groupsDoc = loadGroupsDoc();
  // Tags/groups reference a category by its slug (a stable YAML key), but
  // Tag.category/TagGroup.category store the human-readable display name —
  // that's what CharacterSheet.js's category headings and the GM grant
  // <select> render raw, so the DB should never hold the lowercase slug.
  const categoryNameBySlug = new Map((doc?.categories ?? []).map((c) => [c.slug, c.name]));
  const groupEntries = groupsDoc?.groups ?? [];
  const tagEntries = doc?.tags ?? [];

  for (const g of groupEntries) {
    if (!categoryNameBySlug.has(g.category)) {
      throw new Error(`docs/taggroups.yaml: group "${g.slug}" has unknown category "${g.category}"`);
    }
  }
  const allTagSlugs = new Set(tagEntries.map((t) => t.slug));
  for (const t of tagEntries) {
    if (!categoryNameBySlug.has(t.category)) {
      throw new Error(`docs/tags.yaml: tag "${t.slug}" has unknown category "${t.category}"`);
    }
    // A tag can only conceal an identity by being equipped, so this pairing is
    // a typo guard rather than a rule: concealsIdentity on an un-equippable tag
    // would sync happily and then never do anything, which is the worst kind
    // of quiet failure to debug from inside the game.
    if (t.concealsIdentity && !t.equippable) {
      throw new Error(
        `docs/tags.yaml: tag "${t.slug}" sets concealsIdentity but not equippable — it could never be equipped, so it could never conceal anything`,
      );
    }
    // `visible` is three-state: true, false, or the string "worn" for gear
    // that only a bystander who can see it ON you should know about. Anything
    // else is a typo, and a typo here reads as `false` and quietly hides a tag
    // that was meant to be seen, so say so instead of syncing it.
    if (!VISIBILITY_BY_YAML.has(t.visible ?? false)) {
      throw new Error(
        `docs/tags.yaml: tag "${t.slug}" has visible: ${JSON.stringify(t.visible)} — say true, false, or worn`,
      );
    }
    // Same pairing guard as concealsIdentity above, for the same reason: a tag
    // nobody can equip can never BE equipped, so "visible only while equipped"
    // would sync happily and then hide it from everyone forever.
    if (t.visible === "worn" && !t.equippable) {
      throw new Error(
        `docs/tags.yaml: tag "${t.slug}" sets visible: worn but not equippable — it could never be equipped, so it could never be seen`,
      );
    }
    // `tradeable` decides whether a tag can be handed over or lifted off a body
    // (web/lib/tagRequests.js#isTradeable), and it reads as `?? false` below —
    // so a new item that forgets the field syncs as unmovable and nobody finds
    // out until a player can't hand over the sword they just forged. Silence is
    // the wrong default for a live gate, so items and assets have to say it out
    // loud. Every other category keeps defaulting to false, which is right:
    // a skill or an injury is not a thing you carry.
    if ((t.category === "items" || t.category === "assets") && typeof t.tradeable !== "boolean") {
      throw new Error(
        `docs/tags.yaml: tag "${t.slug}" is in category "${t.category}" but does not set tradeable — say true or false explicitly, since it decides whether the tag can be handed over or looted off a body`,
      );
    }
    // consumesInto is validated up here rather than in a late pass like
    // parentTag/requiredTag: every slug is already known from the document
    // itself, so a typo can fail cleanly instead of half-applying. Both halves
    // of a conditional entry are checked — an unknown blocking tag would
    // silently never block.
    for (const { slug, unlessTags, oneOf } of normalizeConsumesInto(t.consumesInto)) {
      if (!allTagSlugs.has(slug)) {
        throw new Error(`docs/tags.yaml: tag "${t.slug}" consumesInto references unknown tag "${slug}"`);
      }
      for (const blocker of unlessTags) {
        if (!allTagSlugs.has(blocker)) {
          throw new Error(
            `docs/tags.yaml: tag "${t.slug}" consumesInto "${slug}" has unknown unlessTags entry "${blocker}"`,
          );
        }
      }
      for (const alt of oneOf ?? []) {
        if (!allTagSlugs.has(alt)) {
          throw new Error(`docs/tags.yaml: tag "${t.slug}" consumesInto oneOf references unknown tag "${alt}"`);
        }
      }
    }
    // sellable/sellablePrice travel together — a typo on one side would
    // either buy nothing off a player (sellable with no price) or silently
    // never offer a sale (a price nobody switched on).
    if (t.sellable && !(Number.isInteger(t.sellablePrice) && t.sellablePrice > 0)) {
      throw new Error(`docs/tags.yaml: tag "${t.slug}" is sellable but has no positive sellablePrice`);
    }
    if (t.sellablePrice != null && !t.sellable) {
      throw new Error(`docs/tags.yaml: tag "${t.slug}" sets sellablePrice without sellable: true`);
    }
    // depotPrice is the buy side of the same counter, and unlike sellable it
    // travels with no companion flag — carrying a price IS what puts a ware on
    // the Depot's shelf, so there is nothing to fall out of step with.
    if (t.depotPrice != null && !(Number.isInteger(t.depotPrice) && t.depotPrice > 0)) {
      throw new Error(`docs/tags.yaml: tag "${t.slug}" has a depotPrice that is not a positive integer`);
    }
    // Buying a tag and selling it straight back should always lose money. A
    // warning rather than an error: a GM-authored oddity might want the two
    // prices close, and this sync must not become unrunnable over a balance
    // opinion. See docs/systemdocs/DEPOT.md §3.
    if (t.depotPrice != null && t.sellablePrice != null && t.sellablePrice >= t.depotPrice) {
      console.warn(
        `docs/tags.yaml: tag "${t.slug}" sells back for ${t.sellablePrice} ⬢ but costs ${t.depotPrice} ⬢ at the Depot — buying and selling it in a loop prints Resources`,
      );
    }
    // expiresInto, same posture and the same reason: every slug is known from
    // this document, so a typo fails before anything is written. The three
    // rules live in db/lib/tagShapes.js, shared with the GM tag form.
    validateExpiresInto(normalizeExpiresInto(t.expiresInto), {
      selfSlug: t.slug,
      knownSlugs: allTagSlugs,
      durationTurns: t.durationTurns,
    });
    // removesInto — the treated-wound aftermath — same shape, same shared
    // rules, minus the duration requirement (the removal fires it, no clock).
    validateRemovesInto(normalizeRemovesInto(t.removesInto), {
      selfSlug: t.slug,
      knownSlugs: allTagSlugs,
    });
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
      inspectVisibility: VISIBILITY_BY_YAML.get(entry.visible ?? false),
      // At most one exclusive tag per character (the Beliefs). A plain YAML
      // boolean, unlike the three-state `visible` above — the rule itself
      // lives in web/lib/characterCreation.js#exclusiveConflict.
      exclusive: entry.exclusive ?? false,
      tradeable: entry.tradeable ?? false,
      equippable: entry.equippable ?? false,
      concealsIdentity: entry.concealsIdentity ?? false,
      stackable: entry.stackable ?? false,
      purchasable: entry.purchasable ?? false,
      purchasableAfterStart: entry.purchasableAfterStart ?? true,
      sellable: entry.sellable ?? false,
      sellablePrice: entry.sellablePrice ?? null,
      depotPrice: entry.depotPrice ?? null,
      defaultDurationTurns: entry.durationTurns ?? null,
      removable: entry.removable ?? false,
      craftable: entry.craftable ?? false,
      consumable: entry.consumable ?? false,
      consumesIntoResources: entry.consumesIntoResources ?? null,
      expiresInto: normalizeExpiresInto(entry.expiresInto),
      removesInto: normalizeRemovesInto(entry.removesInto),
      requirementTurns: entry.requirement?.turnsCost ?? null,
      requirementResources: entry.requirement?.resourceCost ?? null,
      requirementGambit: entry.requirement?.gambit ?? false,
      ...consumesIntoScalars(entry.consumesInto),
      groupId,
    };

    let tag = await prisma.tag.findUnique({ where: { slug: entry.slug } });
    if (!tag) {
      tag = await prisma.tag.create({ data: { slug: entry.slug, ...scalars } });
      tagsCreated += 1;
    } else {
      // consumesInto is a scalar list, so !== compares references and would
      // report "changed" on every single run. Compare element-wise, and by
      // order — a repeated slug is meaningful (it's how a bundle grants two
      // of something), so this is a sequence, not a set.
      const needsUpdate = Object.entries(scalars).some(([key, value]) => {
        // Arrays and Json objects (consumesInto, consumesIntoUnless,
        // expiresInto) are fresh references every run, so !== would report
        // "changed" on every single one. Stringify instead, which stays
        // order-sensitive — a repeated consumesInto slug is meaningful (it's
        // how a bundle grants two of something), so these are sequences, not
        // sets — and handles expiresInto's object entries, which an
        // element-wise !== could not.
        if (Array.isArray(value) || (value !== null && typeof value === "object")) {
          return JSON.stringify(value) !== JSON.stringify(tag[key]);
        }
        return tag[key] !== value;
      });
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
      throw new Error(`docs/taggroups.yaml: group "${entry.slug}" references unknown requiredTag "${entry.requiredTag}"`);
    }
    const groupId = groupIdBySlug.get(entry.slug);
    const current = await prisma.tagGroup.findUnique({ where: { id: groupId }, select: { requiredTagId: true } });
    if (current.requiredTagId !== requiredTagId) {
      await prisma.tagGroup.update({ where: { id: groupId }, data: { requiredTagId } });
      linksUpdated += 1;
    }
  }

  // Pass 5: requirement.skills slug list -> requirementSkills connections.
  // Self-referential many-to-many, so — same reason as pass 3/4 — this has
  // to wait until every Tag row is guaranteed to exist.
  for (const entry of tagEntries) {
    const skillSlugs = entry.requirement?.skills ?? [];
    const tagId = tagIdBySlug.get(entry.slug);
    const skillIds = skillSlugs.map((slug) => {
      const id = tagIdBySlug.get(slug);
      if (!id) {
        throw new Error(`docs/tags.yaml: tag "${entry.slug}" references unknown requirement skill "${slug}"`);
      }
      return id;
    });

    const current = await prisma.tag.findUnique({
      where: { id: tagId },
      select: { requirementSkills: { select: { id: true } } },
    });
    const currentIds = current.requirementSkills.map((t) => t.id).sort();
    const desiredIds = [...skillIds].sort();
    const changed =
      currentIds.length !== desiredIds.length || currentIds.some((id, i) => id !== desiredIds[i]);
    if (changed) {
      await prisma.tag.update({
        where: { id: tagId },
        data: { requirementSkills: { set: skillIds.map((id) => ({ id })) } },
      });
      linksUpdated += 1;
    }
  }

  return { groupsCreated, groupsUpdated, tagsCreated, tagsUpdated, linksUpdated };
}

module.exports = { syncTagsFromYaml };
