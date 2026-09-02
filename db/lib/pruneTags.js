// The destructive half of the tag sync (`npm run db:prune-tags`) — the only
// tag operation in this repo that deletes anything.
//
// DRY-RUN BY DEFAULT. A tag deletes only when EVERY check below passes; any
// failure is reported with its reason and skipped, never forced.
const fs = require("node:fs");
const yaml = require("js-yaml");
const { docsPath } = require("./repoPaths");
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

// Every reason a Tag row must survive, gathered in one pass.
//
// Role.startingTagSlugs is misnamed and actually stores names (see
// `startingTagNames` in syncRoles.js). Document.tagSlugs stores real slugs.
// expiresInto entries are a bare slug or { oneOf: [slug, slug] }.
function expiresIntoSlugs(entries) {
  if (!Array.isArray(entries)) return [];
  return entries.flatMap((e) => (typeof e === "string" ? [e] : (e?.oneOf ?? [])));
}

async function collectReferences(prisma) {
  const [held, parents, required, groupGates, skills, roles, documents, conflicts, desireTags, consumers] =
    await Promise.all([
      prisma.characterTag.groupBy({ by: ["tagId"], _count: { tagId: true } }),
      prisma.tag.findMany({ where: { parentTagId: { not: null } }, select: { parentTagId: true } }),
      prisma.tag.findMany({ where: { requiredTagId: { not: null } }, select: { requiredTagId: true } }),
      prisma.tagGroup.findMany({ where: { requiredTagId: { not: null } }, select: { requiredTagId: true } }),
      prisma.tag.findMany({ select: { requirementSkills: { select: { id: true } } } }),
      prisma.role.findMany({ select: { startingTagSlugs: true } }),
      prisma.document.findMany({ select: { tagSlugs: true } }),
      // A GM-authored tag's conflictsWith isn't guaranteed symmetric, so both
      // relation directions are read here.
      prisma.tag.findMany({
        select: {
          conflictsWith: { select: { id: true } },
          conflictedBy: { select: { id: true } },
        },
      }),
      prisma.desireTemplate.findMany({
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
          consumesInto: true,
          consumesIntoUnless: true,
          consumesIntoDurations: true,
          expiresInto: true,
        },
      }),
    ]);

  return {
    heldCount: new Map(held.map((h) => [h.tagId, h._count.tagId])),
    parentOf: new Set(parents.map((t) => t.parentTagId)),
    requiredBy: new Set(required.map((t) => t.requiredTagId)),
    gates: new Set(groupGates.map((g) => g.requiredTagId)),
    skillOf: new Set(skills.flatMap((t) => t.requirementSkills.map((s) => s.id))),
    roleStartingNames: new Set(roles.flatMap((r) => r.startingTagSlugs)),
    documentSlugs: new Set(documents.flatMap((d) => d.tagSlugs)),
    conflictIds: new Set(
      conflicts.flatMap((t) => [...t.conflictsWith.map((c) => c.id), ...t.conflictedBy.map((c) => c.id)]),
    ),
    desireTagIds: new Set(
      desireTags.flatMap((d) => [
        ...d.requiresAnyTags.map((t) => t.id),
        ...d.requiresNotTags.map((t) => t.id),
      ]),
    ),
    // Every slug any tag names by slug rather than FK: consumesInto,
    // consumesIntoUnless (targets and blocking slugs), consumesIntoDurations,
    // and expiresInto. None of these is a real DB relation, so this set is
    // the only thing that stops the delete.
    consumeTargets: new Set(
      consumers.flatMap((t) => [
        ...t.consumesInto,
        ...Object.keys(t.consumesIntoUnless ?? {}),
        ...Object.values(t.consumesIntoUnless ?? {}).flat(),
        ...Object.keys(t.consumesIntoDurations ?? {}),
        ...expiresIntoSlugs(t.expiresInto),
      ]),
    ),
  };
}

function blockersFor(tag, refs) {
  const blockers = [];
  const held = refs.heldCount.get(tag.id) ?? 0;
  if (held > 0) blockers.push(held === 1 ? "1 character holds it" : `${held} characters hold it`);
  if (refs.parentOf.has(tag.id)) blockers.push("another tag upgrades from it (parentTag)");
  if (refs.requiredBy.has(tag.id)) blockers.push("another tag requires it (requiredTag)");
  if (refs.gates.has(tag.id)) blockers.push("it gates a TagGroup (hidden category)");
  if (refs.skillOf.has(tag.id)) blockers.push("a tag's cure/craft requirement names it as a skill");
  if (refs.consumeTargets.has(tag.slug)) blockers.push("another tag names it by slug");
  if (refs.roleStartingNames.has(tag.name)) blockers.push("a Role grants it at creation");
  if (refs.documentSlugs.has(tag.slug)) blockers.push("a Document is assigned by it");
  if (refs.conflictIds.has(tag.id)) blockers.push("another tag conflicts with it (conflictsWith)");
  if (refs.desireTagIds.has(tag.id)) blockers.push("a DesireTemplate gates on it (requiresAnyTags/requiresNotTags)");
  return blockers;
}

// Returns { deletable, skipped, deleted } — `deleted` is 0 unless `apply`.
async function pruneTagsFromYaml(prisma, { apply = false } = {}) {
  const inYaml = yamlSlugs();
  const [tags, refs] = await Promise.all([
    prisma.tag.findMany({ select: { id: true, name: true, slug: true, custom: true } }),
    collectReferences(prisma),
  ]);

  const deletable = [];
  const skipped = [];

  for (const tag of tags) {
    if (inYaml.has(tag.slug)) continue; // still declared; not a prune candidate
    // A GM's homebrew lives only in the DB and is never orphaned.
    if (tag.custom) {
      skipped.push({ tag, reasons: ["GM-created (custom)"] });
      continue;
    }
    const reasons = blockersFor(tag, refs);
    if (reasons.length) skipped.push({ tag, reasons });
    else deletable.push(tag);
  }

  let deleted = 0;
  if (apply && deletable.length) {
    // Every row here is provably unreferenced — nothing to cascade.
    const result = await prisma.tag.deleteMany({ where: { id: { in: deletable.map((t) => t.id) } } });
    deleted = result.count;
  }

  return { deletable, skipped, deleted };
}

module.exports = { pruneTagsFromYaml };
