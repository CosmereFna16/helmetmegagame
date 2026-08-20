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
  if (tag.requirementTurns) parts.push(`${tag.requirementTurns}t`);
  if (tag.requirementResources) parts.push(`${tag.requirementResources}res`);
  if (tag.requirementSkills?.length) {
    parts.push(tag.requirementSkills.map((t) => t.name).join("/"));
  }
  if (tag.requirementGambit) parts.push("Gambit");
  return parts.length > 0 ? parts.join(" · ") : null;
}
