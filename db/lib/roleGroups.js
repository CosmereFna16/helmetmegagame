// How the character-creation picker is grouped, and the only place that
// grouping lives. See docs/systemdocs/CHARACTERS.md.
//
// The picker used to nest Zone -> Faction -> Role, which is the shape the
// database stores and the shape docs/roles.yaml is written in. It read as a
// map. What a player actually chooses between is a social position — court,
// clergy, trade, dirt — and those cut ACROSS the zones: the Church and the
// Order of the Silver Cross are both in Town and are both clergy; the Company
// sits in the Caves and the Factory in the Marshes and both are business.
//
// So the buckets below are a third axis, and they belong here rather than in
// docs/roles.yaml for the reason PERMANENT_SEAT_ROLE_SLUGS
// (db/lib/roleCapacity.js) does: it is a small by-slug fact about roles, the
// sync has no business reading it, and a typo here must never be able to
// throw db:sync-roles mid-pass with the factions already written.
//
// A faction's zone is NOT lost by this — Faction.zoneId is untouched, the
// faction detail page still chips it, and each role card still prints the zone
// its holder starts in. Only the picker's headings changed.
const ROLE_GROUPS = [
  { slug: "court", name: "Court", factionSlugs: ["the-court"] },
  { slug: "clergy", name: "Clergy", factionSlugs: ["the-church", "order-of-the-silver-cross"] },
  { slug: "cerberon", name: "Cerberon", factionSlugs: ["cerberon"] },
  { slug: "saviors", name: "Saviors", factionSlugs: ["the-sanctuary"] },
  { slug: "business", name: "Business", factionSlugs: ["the-company", "the-factory"] },
  { slug: "soil", name: "Soil", factionSlugs: ["the-town", "the-inn"] },
  { slug: "outsiders", name: "Outsiders", factionSlugs: ["brigands", "unaffiliated"] },
];

// Where a faction nobody has bucketed ends up. It exists so that adding a
// faction to docs/roles.yaml and forgetting this file makes its roles look
// untidy rather than making them UNPICKABLE — a silently dropped bucket would
// be a seat nobody can take, discovered by a player rather than by us.
const OTHER_GROUP = { slug: "other", name: "Elsewhere", factionSlugs: [] };

// Buckets a list of factions, in the order above, dropping any bucket that
// ends up empty. `factions` is anything carrying a `slug`; each returned group
// holds the matching ones in the order they were given, so the caller's own
// sortOrder still decides what comes first inside a bucket.
function groupFactions(factions) {
  const rows = Array.isArray(factions) ? factions : [];
  const bucketOf = new Map();
  for (const group of ROLE_GROUPS) {
    for (const slug of group.factionSlugs) bucketOf.set(slug, group.slug);
  }

  const held = new Map([...ROLE_GROUPS, OTHER_GROUP].map((g) => [g.slug, []]));
  for (const faction of rows) {
    held.get(bucketOf.get(faction.slug) ?? OTHER_GROUP.slug).push(faction);
  }

  return [...ROLE_GROUPS, OTHER_GROUP]
    .map((group) => ({ slug: group.slug, name: group.name, factions: held.get(group.slug) }))
    .filter((group) => group.factions.length > 0);
}

module.exports = { ROLE_GROUPS, groupFactions };
