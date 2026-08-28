// What a consumable actually turns into for a given character.
//
// Tag.consumesInto lists every possible target; Tag.consumesIntoUnless carries
// the conditions, as { "<target slug>": ["<blocking slug>", ...] } — a target
// is granted only if the character holds none of its blocking tags. No tag
// sets this today (Fine Meal was the only one, and its condition went with the
// Mood system), but the mechanism is general and the resolver still honours it.
//
// Tag.consumesIntoDurations is the other sidecar, { "<target slug>": N }: the
// granted tag expires in N turns instead of its own defaultDurationTurns. Raw
// Cave Fungus and refined Bliss both leave you High, for 2 turns and 3
// respectively — one status, two lifetimes, decided by what you took.
//
// Tag.consumesIntoOneOf is a third sidecar, added for the Caves Update's
// Skinned Cave Rat: a parallel array to consumesInto, same length and order,
// where each entry is either null (that position is a plain grant) or a list
// of two-or-more slugs to pick between with even odds — the corresponding
// consumesInto[i] holds the first alternative only as a display fallback for
// any older caller that ignores this field.
//
// Tag.consumesIntoResources is the Resources half, added for the same
// update's Purse and Supply Kit — a flat amount of ⬢ granted alongside (or
// instead of) any tag.
//
// Deliberately pure — no Prisma, no server imports — because the server action
// and the client-side "Becomes:" previews must agree. A preview that promised
// something the grant then withheld would be a lie the player only discovers
// after spending the item. The one exception is the oneOf roll itself, which
// is why callers that need a STABLE preview (rather than committing to an
// outcome) should read consumesIntoOneOf directly and render "A or B" rather
// than calling this function twice and risking two different answers.

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
