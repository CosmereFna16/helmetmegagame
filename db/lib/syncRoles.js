// docs/roles.yaml -> the Zone/Faction/Role tables. Called by
// db/prisma/sync-roles.js (`npm run db:sync-roles`) and by wipeGameData's
// "Restart Game" flow (web/app/(app)/gm/dev/actions.js).
//
// Supersedes the old db/lib/factionSync.js, which read the same file but
// only for faction name/parent/starting_resources and ignored roles entirely.
//
// Ordering matters: this must run AFTER syncLocationsFromYaml (roles resolve
// a starting Location by slug, and Factions attach to a Zone by name) and
// AFTER syncTagsFromYaml (starting_tags are validated against the catalog).
//
// Passes:
//   1. Upsert Faction by slug — name, zone, sortOrder. `silo` is seeded from
//      starting_resources on CREATE only; an existing row's silo is live
//      game state and is never overwritten (same guard factionSync.js had).
//   2. Resolve each faction's `parent:` slug to parentFactionId, once every
//      faction row is guaranteed to exist.
//   3. Upsert Role by slug — the whole starting package.
//   4. Prune roles/factions that dropped out of the YAML, but only when
//      nothing references them (see below).
//
// Threats are not in this file at all — they live in docs/threats.md as
// prose, since those seats are assigned by hand by a GM and must never show
// up in the player-facing picker.
//
// Validation is strict and up-front: an unknown starting_location slug or an
// unknown starting_tags name throws before anything is written, so a typo in
// the YAML can't half-apply and ship characters missing part of their
// starting package.
const fs = require("node:fs");
const path = require("node:path");
const yaml = require("js-yaml");

function loadDoc() {
  const yamlPath = path.join(__dirname, "..", "..", "docs", "roles.yaml");
  return yaml.load(fs.readFileSync(yamlPath, "utf8"));
}

// Flattens the zone -> faction -> role nesting into two lists, preserving
// authoring order as sortOrder so the picker reads the way the YAML does.
function parseRolesYaml(doc) {
  const factions = [];
  const roles = [];
  for (const zone of doc?.zones ?? []) {
    let factionOrder = 0;
    for (const faction of zone?.factions ?? []) {
      if (!faction.slug) throw new Error(`docs/roles.yaml: faction "${faction.name}" has no slug`);
      factions.push({
        slug: faction.slug,
        name: faction.name,
        zoneName: zone.name,
        parentSlug: faction.parent ?? null,
        startingResources: faction.starting_resources ?? 0,
        sortOrder: factionOrder++,
      });

      let roleOrder = 0;
      for (const role of faction?.roles ?? []) {
        if (!role.slug) throw new Error(`docs/roles.yaml: role "${role.name}" has no slug`);
        roles.push({
          slug: role.slug,
          name: role.name,
          intro: (role.intro ?? "").trim(),
          description: role.description ?? [],
          difficulty: role.difficulty ?? null,
          factionSlug: faction.slug,
          sortOrder: roleOrder++,
          // `multiple: false` means one specific named character. `weight:
          // unlimited` means uncapped. Anything else carries a numeric weight.
          isUnique: role.multiple === false,
          unlimited: role.weight === "unlimited",
          weight: typeof role.weight === "number" ? role.weight : null,
          startingResources: role.starting_resources ?? 0,
          extraStartingPoints: role.extra_starting_points ?? 0,
          startingLocationSlug: role.starting_location ?? null,
          startingTagNames: role.starting_tags ?? [],
          grantsLeader: role.leader === true,
          grantsTreasurer: role.treasurer === true,
          docElements: role.doc_elements ?? [],
        });
      }
    }
  }
  return { factions, roles };
}

// `parent:` in the YAML is written as a faction NAME, but slugs are the match
// key everywhere else — resolve names to slugs once, up front.
function resolveParentSlugs(factions) {
  const slugByName = new Map(factions.map((f) => [f.name, f.slug]));
  for (const f of factions) {
    if (!f.parentSlug) continue;
    const resolved = slugByName.get(f.parentSlug);
    if (!resolved) throw new Error(`docs/roles.yaml: faction "${f.name}" has unknown parent "${f.parentSlug}"`);
    f.parentSlug = resolved;
  }
}

function changed(row, data) {
  return Object.entries(data).some(([key, value]) =>
    Array.isArray(value) ? JSON.stringify(row[key]) !== JSON.stringify(value) : row[key] !== value,
  );
}

async function syncRolesFromYaml(prisma) {
  const { factions, roles } = parseRolesYaml(loadDoc());
  resolveParentSlugs(factions);

  const slugs = { faction: new Set(), role: new Set() };
  for (const f of factions) {
    if (slugs.faction.has(f.slug)) throw new Error(`docs/roles.yaml: duplicate faction slug "${f.slug}"`);
    slugs.faction.add(f.slug);
  }
  for (const r of roles) {
    if (slugs.role.has(r.slug)) throw new Error(`docs/roles.yaml: duplicate role slug "${r.slug}"`);
    slugs.role.add(r.slug);
  }

  // Validate every cross-file reference before writing anything.
  const zoneIdByName = new Map((await prisma.zone.findMany()).map((z) => [z.name, z.id]));
  const locationIdBySlug = new Map((await prisma.location.findMany()).map((l) => [l.slug, l.id]));
  const tagNames = new Set((await prisma.tag.findMany({ select: { name: true } })).map((t) => t.name));

  for (const f of factions) {
    if (!zoneIdByName.has(f.zoneName)) {
      throw new Error(`docs/roles.yaml: faction "${f.name}" is in unknown zone "${f.zoneName}" — run db:sync-locations first`);
    }
  }
  for (const r of roles) {
    if (r.startingLocationSlug && !locationIdBySlug.has(r.startingLocationSlug)) {
      throw new Error(`docs/roles.yaml: role "${r.name}" has unknown starting_location "${r.startingLocationSlug}"`);
    }
    for (const name of r.startingTagNames) {
      if (!tagNames.has(name)) {
        throw new Error(`docs/roles.yaml: role "${r.name}" has starting_tag "${name}" not in docs/tags.yaml — run db:sync-tags first`);
      }
    }
  }

  const stats = { factionsCreated: 0, factionsUpdated: 0, rolesCreated: 0, rolesUpdated: 0, rolesPruned: [], factionsPruned: [] };

  // Pass 1: Faction scalars.
  const factionIdBySlug = new Map();
  for (const entry of factions) {
    const data = { name: entry.name, zoneId: zoneIdByName.get(entry.zoneName), sortOrder: entry.sortOrder };
    let row = await prisma.faction.findUnique({ where: { slug: entry.slug } });
    if (!row) {
      // Claim a pre-slug row of the same name rather than duplicating it.
      row = await prisma.faction.findFirst({ where: { name: entry.name, slug: null } });
      if (row) {
        row = await prisma.faction.update({ where: { id: row.id }, data: { slug: entry.slug, ...data } });
        stats.factionsUpdated++;
      } else {
        row = await prisma.faction.create({ data: { slug: entry.slug, silo: entry.startingResources, ...data } });
        stats.factionsCreated++;
      }
    } else if (changed(row, data)) {
      row = await prisma.faction.update({ where: { id: row.id }, data });
      stats.factionsUpdated++;
    }
    factionIdBySlug.set(entry.slug, row.id);
  }

  // Pass 2: faction hierarchy, now that every row exists.
  for (const entry of factions) {
    const parentFactionId = entry.parentSlug ? factionIdBySlug.get(entry.parentSlug) : null;
    const id = factionIdBySlug.get(entry.slug);
    const current = await prisma.faction.findUnique({ where: { id }, select: { parentFactionId: true } });
    if (current.parentFactionId !== parentFactionId) {
      await prisma.faction.update({ where: { id }, data: { parentFactionId } });
    }
  }

  // Pass 3: Role scalars.
  for (const entry of roles) {
    const data = {
      name: entry.name,
      intro: entry.intro,
      description: entry.description,
      difficulty: entry.difficulty,
      factionId: factionIdBySlug.get(entry.factionSlug),
      sortOrder: entry.sortOrder,
      isUnique: entry.isUnique,
      unlimited: entry.unlimited,
      weight: entry.weight,
      startingResources: entry.startingResources,
      extraStartingPoints: entry.extraStartingPoints,
      startingTagSlugs: entry.startingTagNames,
      grantsLeader: entry.grantsLeader,
      grantsTreasurer: entry.grantsTreasurer,
      docElements: entry.docElements,
      startingLocationId: entry.startingLocationSlug ? locationIdBySlug.get(entry.startingLocationSlug) : null,
    };
    const row = await prisma.role.findUnique({ where: { slug: entry.slug } });
    if (!row) {
      await prisma.role.create({ data: { slug: entry.slug, ...data } });
      stats.rolesCreated++;
    } else if (changed(row, data)) {
      await prisma.role.update({ where: { id: row.id }, data });
      stats.rolesUpdated++;
    }
  }

  // Pass 4: prune. Unlike syncLocations (hard-destructive) this only removes
  // rows nothing points at — a Role still held by a character, or a Faction
  // with members or a non-empty silo, is left in place and reported instead,
  // since deleting it would orphan live game state.
  for (const role of await prisma.role.findMany({
    where: { slug: { notIn: [...slugs.role] } },
    include: { _count: { select: { characters: true } } },
  })) {
    if (role._count.characters > 0) {
      console.warn(`Role "${role.name}" dropped out of roles.yaml but ${role._count.characters} character(s) still hold it — keeping`);
      continue;
    }
    await prisma.role.delete({ where: { id: role.id } });
    stats.rolesPruned.push(role.name);
  }

  for (const faction of await prisma.faction.findMany({
    where: { slug: { notIn: [...slugs.faction] } },
    include: { _count: { select: { characters: true, roles: true } } },
  })) {
    if (faction._count.characters > 0 || faction._count.roles > 0 || faction.silo !== 0) {
      console.warn(`Faction "${faction.name}" dropped out of roles.yaml but still has members/roles/silo — keeping`);
      continue;
    }
    await prisma.faction.delete({ where: { id: faction.id } });
    stats.factionsPruned.push(faction.name);
  }

  return stats;
}

module.exports = { syncRolesFromYaml, parseRolesYaml };
