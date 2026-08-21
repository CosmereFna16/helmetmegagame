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
  // Spelled out, not "1t": the chip face uses a `Nt` badge for turns
  // REMAINING, and an unlabelled "1t" here (turns of work to cure) sat in
  // the same tooltip meaning something unrelated.
  if (tag.requirementTurns) {
    parts.push(`${tag.requirementTurns} turn${tag.requirementTurns === 1 ? "" : "s"}`);
  }
  if (tag.requirementResources) parts.push(`${tag.requirementResources} ⬢`);
  if (tag.requirementSkills?.length) {
    parts.push(tag.requirementSkills.map((t) => t.name).join("/"));
  }
  // The Move kind is always stated, so "no Gambit needed" reads differently
  // from "no data" — but only once there's something to qualify. A tag with
  // no requirement block at all (79 of 84) still renders nothing rather than
  // a bare "Routine".
  if (parts.length === 0 && !tag.requirementGambit) return null;
  parts.push(tag.requirementGambit ? "Gambit" : "Routine");
  return parts.join(" · ");
}

module.exports = { formatTagRequirement };
