// Minified "cost to add/remove this tag in play" summary, for compact
// display anywhere a tag's description already renders (web tooltip,
// Discord inspect embed) — see Tag.requirementTurns/requirementResources/
// requirementGambit/requirementSkills in db/prisma/schema.prisma. Lives here
// (rather than in web/ or bot/) since both packages depend on @lifeweb/db
// and would otherwise duplicate this. Returns null when the tag has no
// requirement data set, so callers can skip rendering entirely.
//
// Callers must fetch requirementTurns, requirementResources,
// requirementGambit, requirementItems, and requirementSkills (at least
// { name: true }). A caller that forgets requirementItems renders no
// ingredient line rather than throwing, which is the quiet failure to watch
// for when adding a new surface.
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
    // " + ", not "/": requirementSkills is an AND (every skill must be held,
    // see requireRecipeSkills). A "/" read as "either" — which was harmless
    // while every multi-skill recipe was a mislabelled Dead Simple item, and
    // stopped being harmless the moment a real conjunction landed.
    parts.push(tag.requirementSkills.map((t) => t.name).join(" + "));
  }
  // The ingredient, where a recipe has one that is actually enforced
  // (Tag.requirementItems — two recipes do). `label` is denormalized into the
  // stored Json by the sync precisely so this stays pure and synchronous; see
  // db/lib/tagShapes.js. The chip has no room to add "and you keep it", so the
  // Craft dialog says that instead.
  if (tag.requirementItems?.length) {
    parts.push(`with ${tag.requirementItems.map((i) => i.label).join(" and ")}`);
  }
  // The Move kind is always stated, so "no Gambit needed" reads differently
  // from "no data" — but only once there's something to qualify. A tag with no
  // requirement block at all — most of the catalog, since only Health tags and
  // a handful of craftables carry one — still renders nothing rather than a
  // bare "Routine".
  if (parts.length === 0 && !tag.requirementGambit) return null;
  parts.push(tag.requirementGambit ? "Gambit" : "Routine");
  return parts.join(" · ");
}

module.exports = { formatTagRequirement };
