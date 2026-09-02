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
//
// This function is pure and takes NO prisma handle — it used to run its own
// role.findMany PER TEMPLATE, which meant an N+1 across all 216 templates on
// every /character load and every Dev Panel load. Every caller now hoists a
// single `role.findMany({ select: { slug: true, name: true } })` up front and
// passes the resulting slug -> role Map in.
export function projectDesireTemplateForGates(roleBySlug, template) {
  const resolveRole = (slug) => roleBySlug.get(slug) ?? { slug, name: slug };

  return {
    ...template,
    requiresAnyRoles: (template.requiresAnyRoleSlugs ?? []).map(resolveRole),
    requiresNotRoles: (template.requiresNotRoleSlugs ?? []).map(resolveRole),
  };
}

// Builds the roleBySlug Map a caller passes to projectDesireTemplateForGates
// above, for one or more templates at once. Pass every template that will be
// projected in this request so the single query covers all of them.
export async function loadRoleBySlugForTemplates(prisma, templates) {
  const slugs = new Set();
  for (const t of templates) {
    for (const s of t.requiresAnyRoleSlugs ?? []) slugs.add(s);
    for (const s of t.requiresNotRoleSlugs ?? []) slugs.add(s);
  }
  const roleRows = slugs.size
    ? await prisma.role.findMany({ where: { slug: { in: [...slugs] } }, select: { slug: true, name: true } })
    : [];
  return new Map(roleRows.map((r) => [r.slug, r]));
}

// Tag ids gating a hidden category the character does NOT hold (Demoness,
// Bacchus, etc — see TagGroup.requiredTagId). Shared by every caller that
// evaluates the Desire catalog for a specific character; getting this wrong
// leaks a hidden roster straight into the catalog payload. devPanelData.js
// deliberately does NOT call this — it passes an empty Set instead, because
// that page is superadmin-only and nothing should be withheld from a GM's
// own view.
export async function computeHiddenDesireTagIds(prisma, heldTagIds) {
  const gates = await prisma.tagGroup.findMany({
    where: { requiredTagId: { not: null } },
    select: { requiredTagId: true },
  });
  return new Set(gates.map((g) => g.requiredTagId).filter((id) => id && !heldTagIds.has(id)));
}
