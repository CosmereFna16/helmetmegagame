// The destructive half of the tag sync (`npm run db:prune-tags`) — the only
// tag operation in this repo that deletes anything. Prunes Tags absent from
// docs/tags.yaml, then TagGroups absent from docs/taggroups.yaml.
//
// DRY-RUN BY DEFAULT. A tag deletes only when EVERY check below passes; any
// failure is reported with its reason and skipped, never forced. A group
// deletes only once no surviving tag sits in it.
const fs = require("node:fs");
const yaml = require("js-yaml");
const { docsPath } = require("./repoPaths");
const { startingTagNames } = require("./startingTags");
const { entriesOf } = require("./yamlEntries");

// Fatal if docs/ can't be found — a missing master would read as "everything
// deleted" and prune the lot. See db/lib/repoPaths.js.
function requireDocsPath(...segments) {
  const p = docsPath(...segments);
  if (!p) throw new Error(`Cannot find docs/${segments.join("/")} — see db/lib/repoPaths.js`);
  return p;
}

function yamlSlugs() {
  const yamlPath = requireDocsPath("tags.yaml");
  const doc = yaml.load(fs.readFileSync(yamlPath, "utf8"));
  return new Set(entriesOf(doc?.tags, "slug").map((t) => t.slug));
}

function yamlGroupSlugs() {
  const yamlPath = requireDocsPath("taggroups.yaml");
  const doc = yaml.load(fs.readFileSync(yamlPath, "utf8"));
  return new Set(entriesOf(doc?.groups, "slug").map((g) => g.slug));
}

// Every reason a Tag row must survive, gathered in one pass.
//
// Role.startingTagSlugs is misnamed and actually stores names (see
// `startingTagNames` in syncRoles.js), and an entry may carry a count
// ("Obol x5"), so it goes through the shared parser rather than being read
// raw — otherwise a tag only ever granted with a count reads as unreferenced
// and gets pruned. Document.tagSlugs stores real slugs.
// expiresInto entries are a bare slug or { oneOf: [slug, slug] }.
function expiresIntoSlugs(entries) {
  if (!Array.isArray(entries)) return [];
  return entries.flatMap((e) => (typeof e === "string" ? [e] : (e?.oneOf ?? [])));
}

// A gate only counts if the thing holding it is still live: a TagGroup that
// docs/taggroups.yaml no longer declares is itself about to be pruned below,
// and a DesireTemplate the desire sync has soft-retired is never offered
// again (its m2m join rows cascade when the tag goes). Counting either would
// let a retired catalog pin its own gate tag forever.
async function collectReferences(prisma, liveGroupSlugs) {
  const [held, parents, required, groupGates, skills, roles, documents, conflicts, desireTags, consumers, structures] =
    await Promise.all([
      prisma.characterTag.groupBy({ by: ["tagId"], _count: { tagId: true } }),
      prisma.tag.findMany({ where: { parentTagId: { not: null } }, select: { id: true, parentTagId: true } }),
      prisma.tag.findMany({ where: { requiredTagId: { not: null } }, select: { id: true, requiredTagId: true } }),
      prisma.tagGroup.findMany({
        where: { requiredTagId: { not: null }, slug: { in: [...liveGroupSlugs] } },
        select: { requiredTagId: true },
      }),
      prisma.tag.findMany({ select: { id: true, requirementSkills: { select: { id: true } } } }),
      prisma.role.findMany({ select: { startingTagSlugs: true } }),
      prisma.document.findMany({ select: { tagSlugs: true } }),
      // A GM-authored tag's conflictsWith isn't guaranteed symmetric, so both
      // relation directions are read here.
      prisma.tag.findMany({
        select: {
          id: true,
          conflictsWith: { select: { id: true } },
          conflictedBy: { select: { id: true } },
        },
      }),
      prisma.desireTemplate.findMany({
        where: { retired: false },
        select: {
          requiresAnyTags: { select: { id: true } },
          requiresNotTags: { select: { id: true } },
        },
      }),
      prisma.tag.findMany({
        where: {
          OR: [
            { consumesInto: { isEmpty: false } },
            { consumesIntoUnless: { not: null } },
            { consumesIntoDurations: { not: null } },
            { expiresInto: { not: null } },
          ],
        },
        select: {
          id: true,
          consumesInto: true,
          consumesIntoUnless: true,
          consumesIntoDurations: true,
          expiresInto: true,
        },
      }),
      // A Structure names its type by slug (Structure.typeSlug), not an FK —
      // same reasoning as consumeTargets below. Any status counts: a
      // half-built or ruined Structure still stands somewhere, matched by the
      // catalog slug the prune is about to delete.
      prisma.structure.groupBy({ by: ["typeSlug"], _count: true }),
    ]);

  // Tag-to-tag references keep the id of the tag that MAKES the reference, so
  // the prune can discount one that is itself on the way out: a spell naming
  // its own expiry marker must not keep the marker alive when both go.
  const from = (sourceId, targets) => targets.map((target) => ({ sourceId, target }));
  return {
    heldCount: new Map(held.map((h) => [h.tagId, h._count.tagId])),
    parentOf: parents.map((t) => ({ sourceId: t.id, target: t.parentTagId })),
    requiredBy: required.map((t) => ({ sourceId: t.id, target: t.requiredTagId })),
    gates: new Set(groupGates.map((g) => g.requiredTagId)),
    skillOf: skills.flatMap((t) => from(t.id, t.requirementSkills.map((s) => s.id))),
    roleStartingNames: new Set(roles.flatMap((r) => startingTagNames(r.startingTagSlugs))),
    documentSlugs: new Set(documents.flatMap((d) => d.tagSlugs)),
    conflictIds: conflicts.flatMap((t) =>
      from(t.id, [...t.conflictsWith.map((c) => c.id), ...t.conflictedBy.map((c) => c.id)]),
    ),
    desireTagIds: new Set(
      desireTags.flatMap((d) => [
        ...d.requiresAnyTags.map((t) => t.id),
        ...d.requiresNotTags.map((t) => t.id),
      ]),
    ),
    structureCount: new Map(structures.map((s) => [s.typeSlug, s._count])),
    // Every slug any tag names by slug rather than FK: consumesInto,
    // consumesIntoUnless (targets and blocking slugs), consumesIntoDurations,
    // and expiresInto. None of these is a real DB relation, so this list is
    // the only thing that stops the delete.
    consumeTargets: consumers.flatMap((t) =>
      from(t.id, [
        ...t.consumesInto,
        ...Object.keys(t.consumesIntoUnless ?? {}),
        ...Object.values(t.consumesIntoUnless ?? {}).flat(),
        ...Object.keys(t.consumesIntoDurations ?? {}),
        ...expiresIntoSlugs(t.expiresInto),
      ]),
    ),
  };
}

// `survivorIds`: tags that will still exist after this prune. A reference
// made by a tag outside that set is not a blocker.
function blockersFor(tag, refs, survivorIds) {
  const live = (list, target) => list.some((r) => r.target === target && survivorIds.has(r.sourceId));
  const blockers = [];
  const held = refs.heldCount.get(tag.id) ?? 0;
  if (held > 0) blockers.push(held === 1 ? "1 character holds it" : `${held} characters hold it`);
  if (live(refs.parentOf, tag.id)) blockers.push("another tag upgrades from it (parentTag)");
  if (live(refs.requiredBy, tag.id)) blockers.push("another tag requires it (requiredTag)");
  if (refs.gates.has(tag.id)) blockers.push("it gates a TagGroup (hidden category)");
  if (live(refs.skillOf, tag.id)) blockers.push("a tag's cure/craft requirement names it as a skill");
  if (live(refs.consumeTargets, tag.slug)) blockers.push("another tag names it by slug");
  if (refs.roleStartingNames.has(tag.name)) blockers.push("a Role grants it at creation");
  if (refs.documentSlugs.has(tag.slug)) blockers.push("a Document is assigned by it");
  if (live(refs.conflictIds, tag.id)) blockers.push("another tag conflicts with it (conflictsWith)");
  if (refs.desireTagIds.has(tag.id)) blockers.push("a DesireTemplate gates on it (requiresAnyTags/requiresNotTags)");
  if (refs.structureCount.get(tag.slug) > 0) blockers.push("a Structure of this type stands somewhere");
  return blockers;
}

// Returns { deletable, skipped, deleted, groups } — `deleted` is 0 unless
// `apply`. `groups` is the same shape for TagGroups absent from
// docs/taggroups.yaml: { deletable, skipped, deleted }.
async function pruneTagsFromYaml(prisma, { apply = false } = {}) {
  const inYaml = yamlSlugs();
  const liveGroupSlugs = yamlGroupSlugs();
  const [tags, refs] = await Promise.all([
    prisma.tag.findMany({ select: { id: true, name: true, slug: true, custom: true } }),
    collectReferences(prisma, liveGroupSlugs),
  ]);

  const candidates = [];
  const skipped = [];
  for (const tag of tags) {
    if (inYaml.has(tag.slug)) continue; // still declared; not a prune candidate
    // A GM's homebrew lives only in the DB and is never orphaned.
    if (tag.custom) skipped.push({ tag, reasons: ["GM-created (custom)"] });
    else candidates.push(tag);
  }

  // Fixpoint: start by assuming every candidate goes, then keep any that a
  // blocker pins. A kept candidate's own references become live again, which
  // can pin another, so loop until nothing new is kept.
  let deletable = candidates;
  const pinned = new Map();
  for (;;) {
    const survivorIds = new Set(tags.filter((t) => !deletable.some((d) => d.id === t.id)).map((t) => t.id));
    const stillDeletable = [];
    let changed = false;
    for (const tag of deletable) {
      const reasons = blockersFor(tag, refs, survivorIds);
      if (reasons.length) {
        pinned.set(tag.id, { tag, reasons });
        changed = true;
      } else stillDeletable.push(tag);
    }
    deletable = stillDeletable;
    if (!changed) break;
  }
  skipped.push(...pinned.values());

  let deleted = 0;
  if (apply && deletable.length) {
    // Every row here is provably unreferenced — nothing to cascade.
    const result = await prisma.tag.deleteMany({ where: { id: { in: deletable.map((t) => t.id) } } });
    deleted = result.count;
  }

  const groups = await pruneGroups(prisma, liveGroupSlugs, { apply, deletedTagIds: apply ? new Set(deletable.map((t) => t.id)) : new Set() });

  return { deletable, skipped, deleted, groups };
}

// TagGroups the YAML no longer declares. A group survives while any tag
// still points at it — a tag that is itself only a dry-run candidate counts
// as surviving, so the dry run under-reports rather than over-promises.
async function pruneGroups(prisma, liveGroupSlugs, { apply, deletedTagIds }) {
  const stale = await prisma.tagGroup.findMany({
    where: { slug: { notIn: [...liveGroupSlugs] } },
    select: { id: true, slug: true, name: true, tags: { select: { id: true } } },
  });

  const deletable = [];
  const skipped = [];
  for (const group of stale) {
    const survivors = group.tags.filter((t) => !deletedTagIds.has(t.id)).length;
    if (survivors) {
      skipped.push({ group, reasons: [survivors === 1 ? "1 tag still sits in it" : `${survivors} tags still sit in it`] });
    } else {
      deletable.push(group);
    }
  }

  let deleted = 0;
  if (apply && deletable.length) {
    const result = await prisma.tagGroup.deleteMany({ where: { id: { in: deletable.map((g) => g.id) } } });
    deleted = result.count;
  }
  return { deletable, skipped, deleted };
}

module.exports = { pruneTagsFromYaml };
