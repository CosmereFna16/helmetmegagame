// The zone code — the four zones as a colour vocabulary.
//
// Lives in web/lib rather than db/lib because a CSS token key is of no use to
// the bot; db/lib is for what both faces genuinely need. Nothing here touches
// Prisma.
//
// `Zone` has no slug column — syncLocations.js creates and matches zones by
// name, which that file itself calls a known fragility. Adding a slug would
// mean touching the destructive locations sync for the sake of four rows, so
// instead the name is slugified and checked against the known set. That
// degrades correctly: a renamed or fifth zone yields null and renders the
// neutral chip, rather than an uncoloured mark or a throw.

// Canonical order, matching the zones: → factions: nesting in docs/roles.yaml
// and the Fortress → Town → Windlands → Caves reading order of the map.
export const ZONE_KEYS = ["fortress", "town", "windlands", "caves"];

export function zoneKey(zoneName) {
  if (!zoneName) return null;
  const slug = String(zoneName)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return ZONE_KEYS.includes(slug) ? slug : null;
}

// Sorts a list of {name} zones into the canonical order above, with anything
// unrecognised falling to the end alphabetically rather than vanishing.
export function sortZones(zones) {
  return [...zones].sort((a, b) => {
    const ai = ZONE_KEYS.indexOf(zoneKey(a.name));
    const bi = ZONE_KEYS.indexOf(zoneKey(b.name));
    if (ai === -1 && bi === -1) return a.name.localeCompare(b.name);
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  });
}
