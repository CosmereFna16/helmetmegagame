// docs/documents.yaml -> DB. Called by `npm run db:sync-documents` and the
// "Restart Game" wipe, alongside the location/tag/role syncs.
//
// `key` is the stable match key (docs/roles.yaml's `doc_elements` points at
// it). This sync is DESTRUCTIVE: a document whose key is no longer in the
// YAML is deleted, since a Document carries no player state to preserve.
//
// Assignment fields are validated against the DB, not the YAML — an unknown
// reference throws rather than half-applying.
const fs = require("node:fs");
const yaml = require("js-yaml");
const { docsPath } = require("./repoPaths");

// /documents synthesizes two cards that aren't real rows — the role charter
// ("role") and the pinned Player Handbook ("handbook") — so the sync refuses
// both keys rather than let a real document collide with them.
const RESERVED_KEYS = new Set(["role", "handbook"]);

// "gamemaster" has no Character property; it resolves against the Discord GM
// role at request time instead (web/lib/discordGuild.js#isGm).
const FLAGS = ["leader", "treasurer", "gamemaster"];

// docsPath() is null only when docs/ cannot be found at all, which for a YAML
// master is fatal — a sync with no master would read as "everything was
// deleted from the file" and prune the lot. See db/lib/repoPaths.js.
function requireDocsPath(...segments) {
  const p = docsPath(...segments);
  if (!p) throw new Error(`Cannot find docs/${segments.join("/")} — see db/lib/repoPaths.js`);
  return p;
}

function loadDoc() {
  const yamlPath = requireDocsPath("documents.yaml");
  return yaml.load(fs.readFileSync(yamlPath, "utf8"));
}

// documents.yaml's `tags:` list conflates real Tag names, the Leader/
// Treasurer booleans (not tags — TAGS.md §6), and free-text placeholder
// notes. Each entry routes to whichever bucket it belongs in; anything
// unmatched is reported to the caller instead of thrown.
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
    if (RESERVED_KEYS.has(e.key)) {
      throw new Error(`documents.yaml: "${e.key}" is a reserved key (see RESERVED_KEYS)`);
    }
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
      isSecret: e.secret === true,
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
