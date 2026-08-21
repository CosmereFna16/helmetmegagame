// Minified "cost to add/remove this tag in play" summary, for compact
// display anywhere a tag's description already renders (web tooltip,
// Discord inspect embed) — see Tag.requirementTurns/requirementResources/
// requirementGambit/requirementSkills in db/prisma/schema.prisma. Lives here
// (rather than in web/ or bot/) since both packages depend on @lifeweb/db
// and would otherwise duplicate this. Returns null when the tag has no
// requirement data set, so callers can skip rendering entirely.
//
// Callers must fetch requirementTurns, requirementResources,
// requirementGambit, and requirementSkills (at least { name: true }).
function formatTagRequirement(tag) {
  const parts = [];
  if (tag.requirementTurns) parts.push(`${tag.requirementTurns}t`);
  if (tag.requirementResources) parts.push(`${tag.requirementResources} ⬢`);
  if (tag.requirementSkills?.length) {
    parts.push(tag.requirementSkills.map((t) => t.name).join("/"));
  }
  if (tag.requirementGambit) parts.push("Gambit");
  return parts.length > 0 ? parts.join(" · ") : null;
}

module.exports = { formatTagRequirement };
