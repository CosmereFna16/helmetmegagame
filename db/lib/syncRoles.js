// docs/roles.yaml -> the Zone/Faction/Role tables. Called by
// db/scripts/sync/sync-roles.js (`npm run db:sync-roles`) and by wipeGameData's
// "Restart Game" flow (web/app/(app)/gm/dev/actions.js). Must run AFTER
// syncLocationsFromYaml and syncTagsFromYaml (starting_zone/starting_tags are
// validated against them). Threats live in docs/threats.md, not here.
//
// A faction's parentFactionId is live game state once created, so it is
// only written on CREATE.
const fs = require("node:fs");
const yaml = require("js-yaml");
const { docsPath } = require("./repoPaths");
const { assertTitlesResolve, GENDERS } = require("./titles");
const { entriesOf } = require("./yamlEntries");
const { parseStartingTag } = require("./startingTags");

// docsPath() is null only when docs/ cannot be found at all, which for a YAML
// master is fatal — a sync with no master would read as "everything was
// deleted from the file" and prune the lot. See db/lib/repoPaths.js.
function requireDocsPath(...segments) {
  const p = docsPath(...segments);
  if (!p) throw new Error(`Cannot find docs/${segments.join("/")} — see db/lib/repoPaths.js`);
  return p;
}

function loadDoc() {
  const yamlPath = requireDocsPath("roles.yaml");
  return yaml.load(fs.readFileSync(yamlPath, "utf8"));
}

// Flattens the zone -> faction -> role nesting into two lists, preserving
// authoring order as sortOrder so the picker reads the way the YAML does.
function parseRolesYaml(doc) {
  const factions = [];
  const roles = [];
  for (const zone of doc?.zones ?? []) {
    let factionOrder = 0;
    for (const faction of entriesOf(zone?.factions, "slug")) {
      if (!faction.slug) throw new Error(`docs/roles.yaml: faction "${faction.name}" has no slug`);
      const entry = {
        slug: faction.slug,
        name: faction.name,
        zoneName: zone.name,
        parentSlug: faction.parent ?? null,
        sortOrder: factionOrder++,
      };
      factions.push(entry);

      let roleOrder = 0;
      for (const role of entriesOf(faction?.roles, "slug")) {
        if (!role.slug) throw new Error(`docs/roles.yaml: role "${role.name}" has no slug`);
        const parsedRole = {
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
          startingZoneSlug: role.starting_zone ?? null,
          startingLocationSlug: role.starting_location ?? null,
          startingTagNames: role.starting_tags ?? [],
          grantsLeader: role.leader === true,
          grantsTreasurer: role.treasurer === true,
          // A seat that fixes its holder's gender rather than letting them
          // choose — Baron/Heir MAN, Baroness/Successor WOMAN. Validated
          // against the enum here, so a YAML typo lands as null instead of a
          // Prisma write-time rejection with no hint which role caused it.
          lockedGender: GENDERS.includes(role.gender) ? role.gender : null,
          docElements: role.doc_elements ?? [],
        };
        roles.push(parsedRole);
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
  const zones = await prisma.zone.findMany();
  const zoneIdByName = new Map(zones.map((z) => [z.name, z.id]));
  // starting_zone must be a PRESENCE zone — the Caves group is a container,
  // not a place a character can stand.
  const presenceZoneIdBySlug = new Map(
    zones.filter((z) => z.kind !== "CAVE_GROUP").map((z) => [z.slug, z.id]),
  );
  const tagNames = new Set((await prisma.tag.findMany({ select: { name: true } })).map((t) => t.name));
  // Where a new character of the role STANDS: `starting_location` when the
  // role names one, else the first Location of its `starting_zone`.
  const locations = await prisma.location.findMany({ orderBy: { sortOrder: "asc" } });
  const locationBySlug = new Map(locations.map((l) => [l.slug, l]));
  const firstLocationByZoneId = new Map();
  for (const location of locations) {
    if (!firstLocationByZoneId.has(location.zoneId)) firstLocationByZoneId.set(location.zoneId, location);
  }
  const startingLocationFor = (entry) => {
    if (entry.startingLocationSlug) return locationBySlug.get(entry.startingLocationSlug) ?? null;
    if (!entry.startingZoneSlug) return null;
    return firstLocationByZoneId.get(presenceZoneIdBySlug.get(entry.startingZoneSlug)) ?? null;
  };

  for (const f of factions) {
    if (!zoneIdByName.has(f.zoneName)) {
      throw new Error(`docs/roles.yaml: faction "${f.name}" is in unknown zone "${f.zoneName}" — run db:sync-zones first`);
    }
  }
  for (const r of roles) {
    if (r.startingZoneSlug && !presenceZoneIdBySlug.has(r.startingZoneSlug)) {
      throw new Error(`docs/roles.yaml: role "${r.name}" has unknown or unstandable starting_zone "${r.startingZoneSlug}"`);
    }
    if (r.startingLocationSlug) {
      const location = locationBySlug.get(r.startingLocationSlug);
      if (!location) {
        throw new Error(`docs/roles.yaml: role "${r.name}" has unknown starting_location "${r.startingLocationSlug}" — run db:sync-zones first`);
      }
      if (r.startingZoneSlug && location.zoneId !== presenceZoneIdBySlug.get(r.startingZoneSlug)) {
        throw new Error(`docs/roles.yaml: role "${r.name}": starting_location "${r.startingLocationSlug}" is not in starting_zone "${r.startingZoneSlug}"`);
      }
    }
    // An entry may carry a count — "Obol x5" — so validate the parsed name
    // rather than the raw string. See db/lib/startingTags.js.
    for (const entry of r.startingTagNames) {
      const { name } = parseStartingTag(entry);
      if (!tagNames.has(name)) {
        throw new Error(`docs/roles.yaml: role "${r.name}" has starting_tag "${name}" not in docs/tags.yaml — run db:sync-tags first`);
      }
    }
  }

  const stats = {
    factionsCreated: 0,
    factionsUpdated: 0,
    rolesCreated: 0,
    rolesUpdated: 0,
    rolesPruned: [],
    factionsPruned: [],
  };

  // Pass 1: Faction scalars.
  const factionIdBySlug = new Map();
  // Rows this run brought into existence — the only ones pass 2 parents on an
  // ordinary sync. A pre-slug row being claimed counts as fresh: it has never
  // been through pass 2 before, so it has no live hierarchy to protect.
  const freshFactionIds = new Set();
  for (const entry of factions) {
    const data = {
      name: entry.name,
      zoneId: zoneIdByName.get(entry.zoneName),
      sortOrder: entry.sortOrder,
    };
    let row = await prisma.faction.findUnique({ where: { slug: entry.slug } });
    if (!row) {
      // Claim a pre-slug row of the same name rather than duplicating it.
      row = await prisma.faction.findFirst({ where: { name: entry.name, slug: null } });
      if (row) {
        row = await prisma.faction.update({ where: { id: row.id }, data: { slug: entry.slug, ...data } });
        stats.factionsUpdated++;
        freshFactionIds.add(row.id);
      } else {
        row = await prisma.faction.create({ data: { slug: entry.slug, ...data } });
        stats.factionsCreated++;
        freshFactionIds.add(row.id);
      }
    } else if (changed(row, data)) {
      row = await prisma.faction.update({ where: { id: row.id }, data });
      stats.factionsUpdated++;
    }
    factionIdBySlug.set(entry.slug, row.id);
  }

  // Pass 2: faction hierarchy, now that every row exists. Create-only — a
  // clan can break away or be absorbed mid-game, so only a fresh row takes
  // its parent from the YAML.
  for (const entry of factions) {
    const parentFactionId = entry.parentSlug ? factionIdBySlug.get(entry.parentSlug) : null;
    const id = factionIdBySlug.get(entry.slug);
    if (!freshFactionIds.has(id)) continue;
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
      lockedGender: entry.lockedGender,
      docElements: entry.docElements,
      startingZoneId: entry.startingZoneSlug
        ? presenceZoneIdBySlug.get(entry.startingZoneSlug)
        : (startingLocationFor(entry)?.zoneId ?? null),
      startingLocationId: startingLocationFor(entry)?.id ?? null,
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
  // with members, is left in place and reported instead, since deleting it
  // would orphan live game state.
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
    if (faction._count.characters > 0 || faction._count.roles > 0) {
      console.warn(`Faction "${faction.name}" dropped out of roles.yaml but still has members/roles — keeping`);
      continue;
    }
    await prisma.faction.delete({ where: { id: faction.id } });
    stats.factionsPruned.push(faction.name);
  }

  // Titles are earned from tags and roles (db/lib/titles.js); both catalogs
  // exist by now (SYNC.md). Checked last so a bad reference doesn't abort a
  // sync that has already done its real work.
  await assertTitlesResolve(prisma);

  return stats;
}

module.exports = { syncRolesFromYaml };
