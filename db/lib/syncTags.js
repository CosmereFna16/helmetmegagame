// docs/tags.yaml + docs/taggroups.yaml -> DB, called by db/scripts/sync/sync-tags.js
// (manual `npm run db:sync-tags`) and wipeGameData's "Restart Game" flow
// (web/app/(app)/gm/dev/actions.js) — see docs/systemdocs/TAGS.md.
// Upsert-only and never deletes. Six passes: tags/groups reference each
// other by slug, and some fields can only resolve once every Tag row
// exists. Each pass only writes when something actually changed.
const fs = require("node:fs");
const yaml = require("js-yaml");
const { docsPath } = require("./repoPaths");
const {
  normalizeExpiresInto,
  validateExpiresInto,
  normalizeRemovesInto,
  validateRemovesInto,
} = require("./tagShapes");
const { normalizeDesireLocks, validateDesireLocks } = require("./desireShapes");
const { desireFamilyKeys } = require("./desireFamilies");
const { entriesOf } = require("./yamlEntries");

// `visible:` in docs/tags.yaml -> Tag.inspectVisibility, a real enum rather
// than a truthy string.
const VISIBILITY_BY_YAML = new Map([
  [true, "ALWAYS"],
  [false, "HIDDEN"],
  ["worn", "WORN"],
]);

// Categories whose tags may carry their category as a slug prefix, because a
// hidden power's name ("Heal", "Seductive") is generic enough to collide with
// a general tag. Everywhere else the slug is exactly the slugified name.
const HIDDEN_CATEGORIES = new Set(["demoness", "bacchus"]);

// The one slug rule, applied to Tag.name. Lowercase, punctuation dropped,
// whitespace and colons to hyphens: "Death Wish (Cult)" -> death-wish-cult,
// "True Form: Serpent" -> true-form-serpent.
function slugifyName(name) {
  return String(name ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s:-]/g, "")
    .replace(/[\s:]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

// A consumesInto entry is a bare slug, an object with a condition and/or an
// expiry override, or a random pick between alternatives ({ oneOf: [...] }).
// Every shape normalises to one quad here so validation and the write path
// only ever handle one shape.
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
// The three side columns stay null unless a tag actually uses that shape.
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

// normalizeExpiresInto and its rules live in db/lib/tagShapes.js, shared
// with the GM tag form's expiry picker.

// docsPath() is null only when docs/ cannot be found at all — fatal here,
// since a missing master would read as "everything was deleted" and prune
// the lot. See db/lib/repoPaths.js.
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
  // Category slugs map to display names — that's what the UI renders raw,
  // so the DB should never hold the lowercase slug.
  const categoryNameBySlug = new Map(entriesOf(doc?.categories, "slug").map((c) => [c.slug, c.name]));
  const groupEntries = entriesOf(groupsDoc?.groups, "slug");
  const tagEntries = entriesOf(doc?.tags, "slug");

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
    // A slug is always its name, slugified — so anyone reading a slug in code
    // or in a Desire's requires knows which tag it is. The only exception is a
    // hidden category (demoness, bacchus), where a bare name like "Heal" or
    // "Seductive" collides with a general tag and the category leads instead.
    const wantSlug = slugifyName(t.name);
    const prefixed = `${t.category}-${wantSlug}`;
    const allowed = HIDDEN_CATEGORIES.has(t.category) ? [wantSlug, prefixed] : [wantSlug];
    if (!allowed.includes(t.slug)) {
      throw new Error(
        `docs/tags.yaml: tag "${t.slug}" is named "${t.name}", so its slug should be "${allowed.join('" or "')}" — rename the slug with the name, or fix the name`,
      );
    }
    // concealsIdentity requires equippable — a typo guard, not a rule.
    if (t.concealsIdentity && !t.equippable) {
      throw new Error(
        `docs/tags.yaml: tag "${t.slug}" sets concealsIdentity but not equippable — it could never be equipped, so it could never conceal anything`,
      );
    }
    // `visible` is three-state: true, false, or "worn".
    if (!VISIBILITY_BY_YAML.has(t.visible ?? false)) {
      throw new Error(
        `docs/tags.yaml: tag "${t.slug}" has visible: ${JSON.stringify(t.visible)} — say true, false, or worn`,
      );
    }
    // Same pairing guard as concealsIdentity: visible: worn needs equippable.
    if (t.visible === "worn" && !t.equippable) {
      throw new Error(
        `docs/tags.yaml: tag "${t.slug}" sets visible: worn but not equippable — it could never be equipped, so it could never be seen`,
      );
    }
    // `tradeable` must be explicit for items/assets — silence would default
    // to unmovable and nobody would notice until a player couldn't hand
    // over what they made.
    if ((t.category === "items" || t.category === "assets") && typeof t.tradeable !== "boolean") {
      throw new Error(
        `docs/tags.yaml: tag "${t.slug}" is in category "${t.category}" but does not set tradeable — say true or false explicitly, since it decides whether the tag can be handed over or looted off a body`,
      );
    }
    // consumesInto is validated here, against slugs already known from this
    // document, so a typo fails cleanly instead of half-applying.
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
    // sellable/sellablePrice must travel together.
    if (t.sellable && !(Number.isInteger(t.sellablePrice) && t.sellablePrice > 0)) {
      throw new Error(`docs/tags.yaml: tag "${t.slug}" is sellable but has no positive sellablePrice`);
    }
    if (t.sellablePrice != null && !t.sellable) {
      throw new Error(`docs/tags.yaml: tag "${t.slug}" sets sellablePrice without sellable: true`);
    }
    // depotPrice is the buy side; carrying a price is what puts it on the shelf.
    if (t.depotPrice != null && !(Number.isInteger(t.depotPrice) && t.depotPrice > 0)) {
      throw new Error(`docs/tags.yaml: tag "${t.slug}" has a depotPrice that is not a positive integer`);
    }
    // Warning only, not an error — see docs/systemdocs/DEPOT.md §3.
    if (t.depotPrice != null && t.sellablePrice != null && t.sellablePrice >= t.depotPrice) {
      console.warn(
        `docs/tags.yaml: tag "${t.slug}" sells back for ${t.sellablePrice} ⬢ but costs ${t.depotPrice} ⬢ at the Depot — buying and selling it in a loop prints Resources`,
      );
    }
    // expiresInto/removesInto: shared shape and rules in db/lib/tagShapes.js.
    validateExpiresInto(normalizeExpiresInto(t.expiresInto), {
      selfSlug: t.slug,
      knownSlugs: allTagSlugs,
      durationTurns: t.durationTurns,
    });
    validateRemovesInto(normalizeRemovesInto(t.removesInto), {
      selfSlug: t.slug,
      knownSlugs: allTagSlugs,
    });
    // desires.locks — validated via the shared desireShapes rules. A missing
    // docs/desires.yaml yields an empty family set, so this only throws when
    // a tag actually names one.
    validateDesireLocks(normalizeDesireLocks(t.desires?.locks), {
      slug: t.slug,
      families: desireFamilyKeys(),
    });
    // conflictsWith — a tag cannot conflict with itself.
    for (const other of t.conflictsWith ?? []) {
      if (other === t.slug) {
        throw new Error(`docs/tags.yaml: tag "${t.slug}" lists itself in conflictsWith`);
      }
      if (!allTagSlugs.has(other)) {
        throw new Error(`docs/tags.yaml: tag "${t.slug}" conflictsWith references unknown tag "${other}"`);
      }
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
      inspectVisibility: VISIBILITY_BY_YAML.get(entry.visible ?? false),
      // At most one exclusive tag per character (the Beliefs); rule lives in
      // web/lib/characterCreation.js#exclusiveConflict.
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
      desireLocks: normalizeDesireLocks(entry.desires?.locks),
      groupId,
    };

    let tag = await prisma.tag.findUnique({ where: { slug: entry.slug } });
    if (!tag) {
      tag = await prisma.tag.create({ data: { slug: entry.slug, ...scalars } });
      tagsCreated += 1;
    } else {
      // Arrays/Json fields compare by value (JSON.stringify), order-sensitive
      // — a repeated slug means "grant two", so these are sequences not sets.
      const needsUpdate = Object.entries(scalars).some(([key, value]) => {
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

  // Pass 5: requirement.skills -> requirementSkills connections. Waits until
  // every Tag row exists (self-referential many-to-many).
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

  // Pass 6: conflictsWith -> Tag.conflictsWith, written both directions so a
  // caller only ever checks one side.
  const conflictSlugsBySlug = new Map(tagEntries.map((t) => [t.slug, new Set()]));
  for (const entry of tagEntries) {
    for (const other of entry.conflictsWith ?? []) {
      conflictSlugsBySlug.get(entry.slug).add(other);
      conflictSlugsBySlug.get(other).add(entry.slug);
    }
  }
  for (const entry of tagEntries) {
    const tagId = tagIdBySlug.get(entry.slug);
    const desiredIds = [...conflictSlugsBySlug.get(entry.slug)]
      .map((slug) => tagIdBySlug.get(slug))
      .sort();

    const current = await prisma.tag.findUnique({
      where: { id: tagId },
      select: { conflictsWith: { select: { id: true } } },
    });
    const currentIds = current.conflictsWith.map((t) => t.id).sort();
    const changed =
      currentIds.length !== desiredIds.length || currentIds.some((id, i) => id !== desiredIds[i]);
    if (changed) {
      await prisma.tag.update({
        where: { id: tagId },
        data: { conflictsWith: { set: desiredIds.map((id) => ({ id })) } },
      });
      linksUpdated += 1;
    }
  }

  return { groupsCreated, groupsUpdated, tagsCreated, tagsUpdated, linksUpdated };
}

module.exports = { syncTagsFromYaml };
