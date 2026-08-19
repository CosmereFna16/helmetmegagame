// Manual, terminal-invoked sync from docs/roles.yaml -> the Faction table.
// Run with `npm run db:sync-factions`. Never runs automatically (no cron,
// no per-turn hook), same posture as sync-locations.js.
//
// Faction has no `slug` field, so matching is by `name` (same as the
// existing GM-panel updateFaction/deleteFaction code already does):
//   1. For each yaml faction (zones[].factions[], threats are excluded —
//      they aren't factions), create it if missing with `silo` seeded from
//      `starting_resources`. An *existing* row's `silo` is never touched
//      here, since that's live game state, not source-of-truth data.
//   2. Resolve each faction's `parent:` name to a `parentFactionId`, once
//      every faction from the yaml is guaranteed to exist.
// Like sync-locations.js, this is never destructive — a faction removed
// from the yaml is simply never visited, its row and members left alone.
const fs = require("node:fs");
const path = require("node:path");
const yaml = require("js-yaml");

const ROLES_YAML_PATH = path.join(__dirname, "..", "..", "docs", "roles.yaml");

function parseFactionsFromRolesYaml() {
  const doc = yaml.load(fs.readFileSync(ROLES_YAML_PATH, "utf8"));
  const factions = [];
  for (const zone of doc?.zones ?? []) {
    for (const faction of zone?.factions ?? []) {
      factions.push({
        name: faction.name,
        parent: faction.parent ?? null,
        startingResources: faction.starting_resources ?? 0,
      });
    }
  }
  return factions;
}

async function syncFactionsFromRolesYaml(prisma) {
  const entries = parseFactionsFromRolesYaml();
  const idByName = new Map();

  for (const entry of entries) {
    let row = await prisma.faction.findFirst({ where: { name: entry.name } });
    if (!row) {
      row = await prisma.faction.create({ data: { name: entry.name, silo: entry.startingResources } });
      console.log(`created faction "${entry.name}" (silo ${entry.startingResources})`);
    }
    idByName.set(entry.name, row.id);
  }

  for (const entry of entries) {
    if (!entry.parent) continue;
    const parentId = idByName.get(entry.parent);
    if (!parentId) {
      console.warn(`Unknown parent "${entry.parent}" for faction "${entry.name}" — skipping`);
      continue;
    }
    const childId = idByName.get(entry.name);
    const current = await prisma.faction.findUnique({ where: { id: childId }, select: { parentFactionId: true } });
    if (current.parentFactionId !== parentId) {
      await prisma.faction.update({ where: { id: childId }, data: { parentFactionId: parentId } });
      console.log(`set parent of "${entry.name}" to "${entry.parent}"`);
    }
  }

  return entries;
}

module.exports = { parseFactionsFromRolesYaml, syncFactionsFromRolesYaml };
