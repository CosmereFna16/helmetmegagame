// What a consumable actually turns into for a given character.
//
// Tag.consumesInto lists every possible target; Tag.consumesIntoUnless carries
// the conditions, as { "<target slug>": ["<blocking slug>", ...] } — a target
// is granted only if the character holds none of its blocking tags. Fine Meal
// is the case this exists for: it cheers an ordinary person, while a noble
// expects one as a matter of course and gets only the Ate Meal.
//
// Deliberately pure — no Prisma, no server imports — because the server action
// and the client-side "Becomes:" previews must agree. A preview that promises
// Happy to a Nobility character would be a lie the player only discovers after
// spending the meal.
//
// A repeated slug still means "grant two" (for a stackable target), so this
// filters the list rather than de-duplicating it.

// `heldSlugs` may be a Set or any iterable of slugs.
export function resolveConsumeGrants(tag, heldSlugs) {
  const held = heldSlugs instanceof Set ? heldSlugs : new Set(heldSlugs ?? []);
  const conditions = tag?.consumesIntoUnless ?? null;

  const slugs = [];
  const blocked = [];
  for (const slug of tag?.consumesInto ?? []) {
    const blockers = conditions?.[slug] ?? null;
    if (blockers?.some((b) => held.has(b))) blocked.push(slug);
    else slugs.push(slug);
  }
  return { slugs, blocked };
}

// The held-slug set every call site needs, from the CharacterTag rows they
// already have in hand.
export function heldSlugsOf(characterTags) {
  return new Set((characterTags ?? []).map((ct) => ct.tag?.slug).filter(Boolean));
}
