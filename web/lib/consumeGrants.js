// What a consumable turns into for a character: consumesInto lists targets,
// consumesIntoUnless blocks one if the character holds a blocking slug,
// consumesIntoDurations overrides a grant's expiry, consumesIntoOneOf picks
// between alternatives at one position, consumesIntoResources grants flat ⬢.
//
// Deliberately pure (no Prisma) so previews match real grants. A caller
// needing a stable preview must read consumesIntoOneOf directly, not call
// this twice — a second call can roll a different outcome.

// `heldSlugs` may be a Set or any iterable of slugs. Returns the granted
// slugs (oneOf entries already resolved to one pick), the ones a condition
// blocked, the expiry overrides that apply to the granted ones (a plain
// { slug: turns } map carrying only slugs that survived the filter), and the
// flat Resources amount to credit.
export function resolveConsumeGrants(tag, heldSlugs) {
  const held = heldSlugs instanceof Set ? heldSlugs : new Set(heldSlugs ?? []);
  const conditions = tag?.consumesIntoUnless ?? null;
  const overrides = tag?.consumesIntoDurations ?? null;
  const oneOfList = tag?.consumesIntoOneOf ?? null;

  const slugs = [];
  const blocked = [];
  const durations = {};
  const consumesInto = tag?.consumesInto ?? [];
  for (let i = 0; i < consumesInto.length; i += 1) {
    const alternatives = oneOfList?.[i] ?? null;
    const slug = Array.isArray(alternatives)
      ? alternatives[Math.floor(Math.random() * alternatives.length)]
      : consumesInto[i];
    const blockers = conditions?.[slug] ?? null;
    if (blockers?.some((b) => held.has(b))) {
      blocked.push(slug);
      continue;
    }
    slugs.push(slug);
    const override = overrides?.[slug];
    if (override != null) durations[slug] = override;
  }
  return { slugs, blocked, durations, resources: tag?.consumesIntoResources ?? 0 };
}

// The held-slug set every call site needs, from the CharacterTag rows they
// already have in hand.
export function heldSlugsOf(characterTags) {
  return new Set((characterTags ?? []).map((ct) => ct.tag?.slug).filter(Boolean));
}
