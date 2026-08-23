// What a consumable actually turns into for a given character.
//
// Tag.consumesInto lists every possible target; Tag.consumesIntoUnless carries
// the conditions, as { "<target slug>": ["<blocking slug>", ...] } — a target
// is granted only if the character holds none of its blocking tags. Fine Meal
// is the case this exists for: it cheers an ordinary person, while a noble
// expects one as a matter of course and gets only the Ate Meal.
//
// Tag.consumesIntoDurations is the other sidecar, { "<target slug>": N }: the
// granted tag expires in N turns instead of its own defaultDurationTurns. Raw
// Cave Fungus and refined Bliss both leave you High, for 2 turns and 3
// respectively — one status, two lifetimes, decided by what you took.
//
// Deliberately pure — no Prisma, no server imports — because the server action
// and the client-side "Becomes:" previews must agree. A preview that promises
// Happy to a Nobility character would be a lie the player only discovers after
// spending the meal.
//
// A repeated slug still means "grant two" (for a stackable target), so this
// filters the list rather than de-duplicating it.

// `heldSlugs` may be a Set or any iterable of slugs. Returns the granted
// slugs, the ones a condition blocked, and the expiry overrides that apply to
// the granted ones — the last as a plain { slug: turns } map carrying only
// slugs that actually survived the filter.
export function resolveConsumeGrants(tag, heldSlugs) {
  const held = heldSlugs instanceof Set ? heldSlugs : new Set(heldSlugs ?? []);
  const conditions = tag?.consumesIntoUnless ?? null;
  const overrides = tag?.consumesIntoDurations ?? null;

  const slugs = [];
  const blocked = [];
  const durations = {};
  for (const slug of tag?.consumesInto ?? []) {
    const blockers = conditions?.[slug] ?? null;
    if (blockers?.some((b) => held.has(b))) {
      blocked.push(slug);
      continue;
    }
    slugs.push(slug);
    const override = overrides?.[slug];
    if (override != null) durations[slug] = override;
  }
  return { slugs, blocked, durations };
}

// The held-slug set every call site needs, from the CharacterTag rows they
// already have in hand.
export function heldSlugsOf(characterTags) {
  return new Set((characterTags ?? []).map((ct) => ct.tag?.slug).filter(Boolean));
}
