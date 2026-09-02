// docs/desires.yaml -> DB, called by db/prisma/sync-desires.js (manual
// `npm run db:sync-desires`) and wipeGameData's "Restart Game" flow
// (web/app/(app)/gm/dev/actions.js) — see docs/systemdocs/DESIRES.md.
// This is the sole write path for DesireTemplate rows.
//
// Unlike syncTagsFromYaml (upsert-only, never deletes/hides anything), this
// sync SOFT-RETIRES: a slug present in the DB but absent from the file gets
// `retired: true` (hidden from every picker, existing instances keep
// running), and a slug that comes back gets it cleared. A DesireTemplate is
// pure catalog with a cheap hide, not held state like a Tag — see
// engineering-plan.md §3c.
//
// Four passes:
//   0. Parse + validate everything up front, no writes. Every unknown
//      reference throws before pass 1 touches the DB.
//   1. Upsert each DesireTemplate's scalars by slug, diffing arrays via
//      JSON.stringify (syncTags pass-2 idiom).
//   2. Resolve requiresAnyTags/requiresNotTags with `set:` — the
//      requirementSkills pattern from syncTags pass 5.
//   3. Soft retire: DB slug absent from the file -> retired: true; present
//      -> cleared.
const fs = require("node:fs");
const yaml = require("js-yaml");
const { docsPath } = require("./repoPaths");

const TIER_WHITELIST = new Set([1, 2, 3, 4, 5, 7]);

function requireDocsPath(...segments) {
  const p = docsPath(...segments);
  if (!p) throw new Error(`Cannot find docs/${segments.join("/")} — see db/lib/repoPaths.js`);
  return p;
}

function loadDoc() {
  const yamlPath = requireDocsPath("desires.yaml");
  return yaml.load(fs.readFileSync(yamlPath, "utf8"));
}

async function syncDesiresFromYaml(prisma) {
  const doc = loadDoc();
  const familyEntries = doc?.families ?? [];
  const desireEntries = doc?.desires ?? [];

  // --- Pass 0: parse + validate, no writes. ---------------------------
  const familyKeySet = new Set();
  for (const f of familyEntries) {
    if (!f?.key) throw new Error(`docs/desires.yaml: a families entry is missing "key"`);
    if (familyKeySet.has(f.key)) {
      throw new Error(`docs/desires.yaml: family key "${f.key}" is declared more than once`);
    }
    familyKeySet.add(f.key);
  }

  const slugSet = new Set();
  for (const d of desireEntries) {
    if (!d?.slug) throw new Error(`docs/desires.yaml: a desire entry is missing "slug"`);
    if (slugSet.has(d.slug)) {
      throw new Error(`docs/desires.yaml: desire slug "${d.slug}" is declared more than once`);
    }
    slugSet.add(d.slug);
    if (!d.name || typeof d.name !== "string") {
      throw new Error(`docs/desires.yaml: desire "${d.slug}" has no name`);
    }
    if (!TIER_WHITELIST.has(d.tier)) {
      throw new Error(
        `docs/desires.yaml: desire "${d.slug}" has tier ${JSON.stringify(d.tier)} — must be one of ${[...TIER_WHITELIST].join(", ")}`,
      );
    }
    const families = d.families ?? [];
    for (const key of families) {
      if (!familyKeySet.has(key)) {
        throw new Error(`docs/desires.yaml: desire "${d.slug}" references unknown family "${key}"`);
      }
    }
    if (families.length === 0) {
      console.warn(`docs/desires.yaml: desire "${d.slug}" is in no family`);
    }
    const anyTags = d.requires?.anyTags ?? [];
    const notTags = d.requires?.notTags ?? [];
    const anyRoles = d.requires?.anyRoles ?? [];
    const notRoles = d.requires?.notRoles ?? [];
    const overlap = anyTags.filter((slug) => notTags.includes(slug));
    if (overlap.length > 0) {
      throw new Error(
        `docs/desires.yaml: desire "${d.slug}" has "${overlap[0]}" in both requires.anyTags and requires.notTags`,
      );
    }
    for (const slug of anyTags) {
      if (!(await prisma.tag.findUnique({ where: { slug } }))) {
        throw new Error(`docs/desires.yaml: desire "${d.slug}" requires.anyTags references unknown tag "${slug}" — run npm run db:sync-tags first`);
      }
    }
    for (const slug of notTags) {
      if (!(await prisma.tag.findUnique({ where: { slug } }))) {
        throw new Error(`docs/desires.yaml: desire "${d.slug}" requires.notTags references unknown tag "${slug}" — run npm run db:sync-tags first`);
      }
    }
    for (const slug of anyRoles) {
      if (!(await prisma.role.findUnique({ where: { slug } }))) {
        throw new Error(`docs/desires.yaml: desire "${d.slug}" requires.anyRoles references unknown role "${slug}" — run npm run db:sync-roles first`);
      }
    }
    for (const slug of notRoles) {
      if (!(await prisma.role.findUnique({ where: { slug } }))) {
        throw new Error(`docs/desires.yaml: desire "${d.slug}" requires.notRoles references unknown role "${slug}" — run npm run db:sync-roles first`);
      }
    }
    if (d.cooldownTurns != null && !(Number.isInteger(d.cooldownTurns) && d.cooldownTurns > 0)) {
      throw new Error(`docs/desires.yaml: desire "${d.slug}" has a cooldownTurns that is not a positive whole number`);
    }
    if (d.oncePerLife != null && typeof d.oncePerLife !== "boolean") {
      throw new Error(`docs/desires.yaml: desire "${d.slug}" has a non-boolean oncePerLife`);
    }
    const combine = d.requires?.combine;
    if (combine != null && combine !== "and" && combine !== "or") {
      throw new Error(
        `docs/desires.yaml: desire "${d.slug}" has requires.combine "${combine}" — only "and" (the default) or "or"`,
      );
    }
    // `combine: or` with only one populated list is a silent no-op, and worse,
    // it reads like a working gate. Refuse it rather than ship a Desire whose
    // YAML says one thing and whose evaluation says another.
    if (combine === "or" && (anyTags.length === 0 || anyRoles.length === 0)) {
      throw new Error(
        `docs/desires.yaml: desire "${d.slug}" has requires.combine: or but needs BOTH requires.anyTags and requires.anyRoles to be non-empty`,
      );
    }
  }

  let created = 0;
  let updated = 0;
  let linksUpdated = 0;
  let retired = 0;
  let unretired = 0;

  // --- Pass 1: upsert scalars. -----------------------------------------
  const idBySlug = new Map();
  for (const [index, entry] of desireEntries.entries()) {
    // onceEver defaults true at tier 7 unless the YAML explicitly says
    // oncePerLife (either way — this maps oncePerLife: true at ANY tier to
    // onceEver: true, and oncePerLife: false at tier 7 opts out of the
    // default). engineering-plan.md §3c / task-3 brief.
    const onceEver = entry.oncePerLife != null ? entry.oncePerLife === true : entry.tier === 7;
    const scalars = {
      name: entry.name,
      description: entry.description ?? null,
      tier: entry.tier,
      families: entry.families ?? [],
      onceEver,
      cooldownTurns: entry.cooldownTurns ?? null,
      // Default AND. Only an explicit `combine: or` joins anyTags/anyRoles
      // with OR — see db/lib/desireGates.js#evalRequires.
      requiresAnyOf: entry.requires?.combine === "or",
      sortOrder: index,
    };

    let row = await prisma.desireTemplate.findUnique({ where: { slug: entry.slug } });
    if (!row) {
      row = await prisma.desireTemplate.create({ data: { slug: entry.slug, ...scalars, retired: false } });
      created += 1;
    } else {
      const needsUpdate = Object.entries(scalars).some(([key, value]) => {
        if (Array.isArray(value)) return JSON.stringify(value) !== JSON.stringify(row[key]);
        return row[key] !== value;
      });
      if (needsUpdate) {
        row = await prisma.desireTemplate.update({ where: { id: row.id }, data: scalars });
        updated += 1;
      }
    }
    idBySlug.set(entry.slug, row.id);
  }

  // --- Pass 2: requiresAnyTags/requiresNotTags m2m, requiresAny/NotRoleSlugs. ---
  for (const entry of desireEntries) {
    const id = idBySlug.get(entry.slug);
    const anyTagSlugs = entry.requires?.anyTags ?? [];
    const notTagSlugs = entry.requires?.notTags ?? [];
    const anyRoleSlugs = entry.requires?.anyRoles ?? [];
    const notRoleSlugs = entry.requires?.notRoles ?? [];

    const anyTags = await prisma.tag.findMany({ where: { slug: { in: anyTagSlugs } }, select: { id: true } });
    const notTags = await prisma.tag.findMany({ where: { slug: { in: notTagSlugs } }, select: { id: true } });
    const anyTagIds = anyTags.map((t) => t.id);
    const notTagIds = notTags.map((t) => t.id);

    const current = await prisma.desireTemplate.findUnique({
      where: { id },
      select: {
        requiresAnyTags: { select: { id: true } },
        requiresNotTags: { select: { id: true } },
        requiresAnyRoleSlugs: true,
        requiresNotRoleSlugs: true,
      },
    });
    const currentAnyIds = current.requiresAnyTags.map((t) => t.id).sort();
    const desiredAnyIds = [...anyTagIds].sort();
    const currentNotIds = current.requiresNotTags.map((t) => t.id).sort();
    const desiredNotIds = [...notTagIds].sort();
    const currentAnyRoles = [...current.requiresAnyRoleSlugs].sort();
    const desiredAnyRoles = [...anyRoleSlugs].sort();
    const currentNotRoles = [...current.requiresNotRoleSlugs].sort();
    const desiredNotRoles = [...notRoleSlugs].sort();

    const idsChanged =
      JSON.stringify(currentAnyIds) !== JSON.stringify(desiredAnyIds) ||
      JSON.stringify(currentNotIds) !== JSON.stringify(desiredNotIds);
    const roleSlugsChanged =
      JSON.stringify(currentAnyRoles) !== JSON.stringify(desiredAnyRoles) ||
      JSON.stringify(currentNotRoles) !== JSON.stringify(desiredNotRoles);

    if (idsChanged || roleSlugsChanged) {
      await prisma.desireTemplate.update({
        where: { id },
        data: {
          requiresAnyTags: { set: anyTagIds.map((tid) => ({ id: tid })) },
          requiresNotTags: { set: notTagIds.map((tid) => ({ id: tid })) },
          requiresAnyRoleSlugs: anyRoleSlugs,
          requiresNotRoleSlugs: notRoleSlugs,
        },
      });
      linksUpdated += 1;
    }
  }

  // --- Pass 3: soft retire. --------------------------------------------
  const allRows = await prisma.desireTemplate.findMany({ select: { id: true, slug: true, retired: true } });
  for (const row of allRows) {
    const stillPresent = slugSet.has(row.slug);
    if (!stillPresent && !row.retired) {
      await prisma.desireTemplate.update({ where: { id: row.id }, data: { retired: true } });
      retired += 1;
    } else if (stillPresent && row.retired) {
      await prisma.desireTemplate.update({ where: { id: row.id }, data: { retired: false } });
      unretired += 1;
    }
  }

  return { created, updated, linksUpdated, retired, unretired };
}

module.exports = { syncDesiresFromYaml };
