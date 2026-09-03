// Shared template -> db/lib/desireGates.js projection. A DesireTemplate row
// stores requiresAnyRoleSlugs/requiresNotRoleSlugs as slug arrays (Role rows
// get pruned by db:sync-roles, so an FK would block that); the evaluator
// wants `{ slug, name }` objects so a locked reason can name the role.
//
// Every caller MUST go through this, not re-derive it inline: an unresolved
// slug is kept as `{ slug, name: slug }` rather than filtered out, because
// db/lib/desireGates.js treats an empty anyRoles/notRoles list as NO
// constraint — dropping the slug would silently open a role-gated Desire.
//
// Pure, takes no prisma handle: every caller hoists a single
// `role.findMany({ select: { slug: true, name: true } })` and passes the
// resulting slug -> role Map in, to avoid an N+1 per template.
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
// etc — see TagGroup.requiredTagId). Shared by every caller that
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
