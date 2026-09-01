// Shared template -> db/lib/desireGates.js projection. A DesireTemplate row
// stores requiresAnyRoleSlugs/requiresNotRoleSlugs as slug arrays (Role rows
// get pruned by db:sync-roles, so an FK would block that — same reasoning as
// Document.roleSlugs); the evaluator wants `{ slug, name }` objects so a
// locked reason can name the role without touching the DB itself.
//
// Every caller that resolves a template for evaluateDesireCatalog MUST go
// through this, not re-derive it inline: dropping an unresolvable slug (e.g.
// a role renamed or pruned out from under a live desire) would collapse that
// gate's array to empty, and db/lib/desireGates.js treats an empty
// anyRoles/notRoles list as NO constraint — silently opening a role-gated
// Desire to everyone, or un-locking a forbidden pairing. So an unresolved
// slug is kept as `{ slug, name: slug }` instead of being filtered out: the
// gate still fails closed (nobody's role slug will match a slug that isn't a
// real Role's slug), just with a less pretty name in the reason string.
export async function projectDesireTemplateForGates(prisma, template) {
  const roleSlugsNeeded = [
    ...(template.requiresAnyRoleSlugs ?? []),
    ...(template.requiresNotRoleSlugs ?? []),
  ];
  const roleRows = roleSlugsNeeded.length
    ? await prisma.role.findMany({ where: { slug: { in: roleSlugsNeeded } }, select: { slug: true, name: true } })
    : [];
  const roleBySlug = new Map(roleRows.map((r) => [r.slug, r]));
  const resolveRole = (slug) => roleBySlug.get(slug) ?? { slug, name: slug };

  return {
    ...template,
    requiresAnyRoles: (template.requiresAnyRoleSlugs ?? []).map(resolveRole),
    requiresNotRoles: (template.requiresNotRoleSlugs ?? []).map(resolveRole),
  };
}
