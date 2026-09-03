// The zone code — the zones as a colour vocabulary.
//
// Lives in web/lib rather than db/lib because a CSS token key is of no use to
// the bot; db/lib is for what both faces genuinely need. Nothing here touches
// Prisma.
//
// Callers hand this a zone NAME rather than a slug, because most of them have
// a display row and not a Zone. The name is slugified and checked against the
// known set, which degrades correctly: an unrecognised zone yields null and
// renders the neutral chip, rather than an uncoloured mark or a throw.
//
// "Underground" is deliberately absent. It is a CAVE_GROUP — a category and a
// GM seat, never a place — so it has no chip to colour; its two levels, Caves
// and Depths, carry their own.

// Canonical order, matching the zones: → factions: nesting in docs/roles.yaml
// and the reading order of the map: the two built-up places, the three
// stretches of wild, then down.
export const ZONE_KEYS = [
  "fortress",
  "town",
  "forest",
  "east-forests",
  "marshes",
  "caves",
  "depths",
];

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

// Which zone a GM's table should OPEN on, given their seats.
//
// One seat is the whole point of the feature: the table opens narrowed to it.
// Two or more and there is no single right answer — opening on the first would
// silently hide the other seat's rows behind a filter the GM never set — so the
// table opens on All and the ZoneScopeToggle offers a button per seat instead.
// No seat (the master, or an unassigned GM) is All as well.
//
// `filters.zone` is a zone NAME, matching useTableState's filterDefs.
export function openingZoneName(myZoneNames) {
  return myZoneNames?.length === 1 ? myZoneNames[0] : "";
}
