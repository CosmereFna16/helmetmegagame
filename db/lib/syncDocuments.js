// docs/documents.yaml -> DB, called by db/prisma/sync-documents.js (manual
// `npm run db:sync-documents`) and wipeGameData's "Restart Game" flow
// (web/app/(app)/gm/dev/actions.js), alongside the location/tag/role syncs.
//
// docs/documents.yaml is the sole master for the Document catalog and `key`
// is the stable match key — the same thing docs/roles.yaml's `doc_elements`
// lists point at. Unlike syncTags (upsert-only), this sync is **destructive**
// in the syncLocations sense: a document whose key is no longer in the YAML
// has its row deleted. There is no player state on a Document — it's pure
// reference content — so there's nothing to preserve and a stale row would
// keep showing up in players' folders.
//
// Assignment fields are validated against the DB rather than the YAML, since
// tags/roles/factions are themselves synced from their own masters. An
// unknown reference throws rather than half-applying, the same contract
// syncRoles uses for starting_tags — with one carve-out noted at
// resolveAssignment() below.
const fs = require("node:fs");
const path = require("node:path");
const yaml = require("js-yaml");

const FLAGS = ["leader", "treasurer"];

function loadDoc() {
  const yamlPath = path.join(__dirname, "..", "..", "docs", "documents.yaml");
  return yaml.load(fs.readFileSync(yamlPath, "utf8"));
}

// documents.yaml's `tags:` list predates this sync and conflates three
// things: real Tag names, the Leader/Treasurer booleans on Character (which
// are not tags — see docs/systemdocs/TAGS.md §6), and free-text placeholders
// like "any of the medical tags" left in as authoring notes. Rather than
// force the YAML to be rewritten, each entry is routed to whichever bucket
// it actually belongs in, and anything that matches nothing is reported to
// the caller instead of throwing — a placeholder is a note to a human, not a
// broken reference.
function resolveAssignment(entry, catalogs) {
  const { tagNames, tagSlugByName, roleSlugs, factionSlugs } = catalogs;
  const out = { tagSlugs: [], roleSlugs: [], factionSlugs: [], flags: [] };
  const unresolved = [];

  for (const raw of entry.tags ?? []) {
    const name = String(raw).trim();
    if (!name) continue;
    const lower = name.toLowerCase();
    if (FLAGS.includes(lower)) out.flags.push(lower);
    else if (tagNames.has(name)) out.tagSlugs.push(tagSlugByName.get(name));
    else unresolved.push(name);
  }
  // Explicit keys, added so assignment doesn't have to be smuggled through
  // `tags:`. These are strict: a typo'd slug here is a mistake, not a note.
  for (const slug of entry.roles ?? []) {
    if (!roleSlugs.has(slug)) throw new Error(`documents.yaml: "${entry.key}" references unknown role "${slug}"`);
    out.roleSlugs.push(slug);
  }
  for (const slug of entry.factions ?? []) {
    if (!factionSlugs.has(slug)) throw new Error(`documents.yaml: "${entry.key}" references unknown faction "${slug}"`);
    out.factionSlugs.push(slug);
  }
  for (const flag of entry.flags ?? []) {
    const lower = String(flag).toLowerCase();
    if (!FLAGS.includes(lower)) throw new Error(`documents.yaml: "${entry.key}" references unknown flag "${flag}" (expected ${FLAGS.join(" or ")})`);
    out.flags.push(lower);
  }

  for (const k of Object.keys(out)) out[k] = [...new Set(out[k])];
  return { assignment: out, unresolved };
}

async function syncDocumentsFromYaml(prisma) {
  const doc = loadDoc();
  const entries = doc?.documents ?? [];

  const seen = new Set();
  for (const e of entries) {
    if (!e.key) throw new Error(`documents.yaml: entry "${e.name ?? "(unnamed)"}" has no key`);
    if (seen.has(e.key)) throw new Error(`documents.yaml: duplicate key "${e.key}"`);
    seen.add(e.key);
  }

  const [tags, roles, factions] = await Promise.all([
    prisma.tag.findMany({ select: { name: true, slug: true } }),
    prisma.role.findMany({ select: { slug: true } }),
    prisma.faction.findMany({ select: { slug: true } }),
  ]);
  const catalogs = {
    tagNames: new Set(tags.map((t) => t.name)),
    tagSlugByName: new Map(tags.map((t) => [t.name, t.slug])),
    roleSlugs: new Set(roles.map((r) => r.slug).filter(Boolean)),
    factionSlugs: new Set(factions.map((f) => f.slug).filter(Boolean)),
  };

  const summary = { created: 0, updated: 0, pruned: [], unresolved: {} };

  for (const [i, e] of entries.entries()) {
    const { assignment, unresolved } = resolveAssignment(e, catalogs);
    if (unresolved.length) summary.unresolved[e.key] = unresolved;

    const data = {
      name: e.name ?? e.key,
      description: e.description ?? "",
      isPublic: e.public === true,
      sortOrder: i,
      ...assignment,
    };
    const existing = await prisma.document.findUnique({ where: { key: e.key } });
    if (existing) {
      await prisma.document.update({ where: { key: e.key }, data });
      summary.updated += 1;
    } else {
      await prisma.document.create({ data: { key: e.key, ...data } });
      summary.created += 1;
    }
  }

  const stale = await prisma.document.findMany({ where: { key: { notIn: [...seen] } }, select: { key: true } });
  if (stale.length) {
    await prisma.document.deleteMany({ where: { key: { in: stale.map((s) => s.key) } } });
    summary.pruned = stale.map((s) => s.key);
  }

  return summary;
}

module.exports = { syncDocumentsFromYaml };
