// The destructive half of the tag sync, and the only tag operation in this
// repo that deletes anything.
//
// syncTagsFromYaml (db/lib/syncTags.js) is upsert-only by design: dropping an
// entry from docs/tags.yaml leaves its DB row untouched forever. That is the
// right default — a tag a character holds must never vanish because someone
// tidied a YAML file — but it means the catalog only ever grows. This is the
// deliberate, separately-invoked counterpart: `npm run db:prune-tags`.
//
// It is DRY-RUN BY DEFAULT. Nothing is deleted without `--apply`.
//
// A tag is deletable only when EVERY check below passes. Anything that fails
// even one is reported with its reason and skipped — never cascaded, never
// forced. A prune that silently skips is worse than one that deletes, so the
// caller prints every refusal.
const fs = require("node:fs");
const yaml = require("js-yaml");
const { docsPath } = require("./repoPaths");

// docsPath() is null only when docs/ cannot be found at all, which for a YAML
// master is fatal — a sync with no master would read as "everything was
// deleted from the file" and prune the lot. See db/lib/repoPaths.js.
function requireDocsPath(...segments) {
  const p = docsPath(...segments);
  if (!p) throw new Error(`Cannot find docs/${segments.join("/")} — see db/lib/repoPaths.js`);
  return p;
}

function yamlSlugs() {
  const yamlPath = requireDocsPath("tags.yaml");
  const doc = yaml.load(fs.readFileSync(yamlPath, "utf8"));
  return new Set((doc?.tags ?? []).map((t) => t.slug));
}

// Every reason a Tag row must survive, gathered in one pass so the report can
// name all of them at once rather than stopping at the first.
//
// The Role check compares against tag NAMES, not slugs: Role.startingTagSlugs
// is misnamed and actually stores names (see the `startingTagNames` mapping in
// db/lib/syncRoles.js). Document.tagSlugs really does store slugs.
// expiresInto is a Json array whose entries are either a bare slug or
// { oneOf: ["slug", "slug"] } for a random pick between them.
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
      // conflictsWith is written in BOTH directions by db:sync-tags (SYNC.md
      // pass 6), so reading conflictsWith alone already sees every edge —
      // but this runs against the live DB, not the YAML, and a GM-authored
      // custom tag's conflictsWith is never guaranteed symmetric. Read both
      // relations so an asymmetric edge still blocks the delete.
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
    // Union of both relation directions — see the comment on the query above.
    conflictIds: new Set(
      conflicts.flatMap((t) => [...t.conflictsWith.map((c) => c.id), ...t.conflictedBy.map((c) => c.id)]),
    ),
    desireTagIds: new Set(
      desireTags.flatMap((d) => [
        ...d.requiresAnyTags.map((t) => t.id),
        ...d.requiresNotTags.map((t) => t.id),
      ]),
    ),
    // Every slug any tag names, in any of the four ways one tag can point at
    // another by slug rather than by foreign key:
    //
    //   consumesInto          the targets a consumed tag grants
    //   consumesIntoUnless    { target: [blocking slugs] } — the BLOCKING
    //                         slugs count too, or pruning one silently turns
    //                         a conditional grant unconditional. No tag uses
    //                         this today, but the guard stays for the next
    //                         one that does.
    //   consumesIntoDurations { target: turns } — a per-grant duration override
    //   expiresInto           the on-the-clock progression, entries being a
    //                         bare slug or { oneOf: [slug, slug] }; pruning a
    //                         link here breaks the untreated-wound chain
    //
    // None of these is a real relation, so nothing in the database stops the
    // delete — this set is the only thing that does.
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
  // The group gate is the hidden-category mechanism (TagGroup.requiredTag).
  // Deleting one would silently open a whole hidden category to everyone.
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
    // A GM's homebrew is not orphaned just because docs/tags.yaml never
    // mentioned it. It is the one kind of row that lives only in the DB.
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
    // One statement — every row here is provably unreferenced, so there is
    // no ordering problem and nothing to cascade.
    const result = await prisma.tag.deleteMany({ where: { id: { in: deletable.map((t) => t.id) } } });
    deleted = result.count;
  }

  return { deletable, skipped, deleted };
}

module.exports = { pruneTagsFromYaml };
