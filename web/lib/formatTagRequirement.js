// Minified "cost to add/remove this tag in play" summary, for compact
// display anywhere a tag's description already renders (web tooltip). Kept
// as a client-safe duplicate of db/lib/formatTagRequirement.js — that
// version is re-exported through @lifeweb/db's barrel (db/index.js), which
// unconditionally requires @prisma/client and leaks node:fs into any
// "use client" bundle that imports from it. This copy has zero deps so it's
// safe for client components (PointBuy.js, TagChip.js).
//
// Callers must fetch requirementTurns, requirementResources,
// requirementGambit, and requirementSkills (at least { name: true }).
export function formatTagRequirement(tag) {
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
  // from "no data" — but only once there's something to qualify. A tag with no
  // requirement block at all — most of the catalog, since only Health tags and
  // a handful of craftables carry one — still renders nothing rather than a
  // bare "Routine".
  if (parts.length === 0 && !tag.requirementGambit) return null;
  parts.push(tag.requirementGambit ? "Gambit" : "Routine");
  return parts.join(" · ");
}
