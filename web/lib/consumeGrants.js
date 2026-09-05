// What a consumable turns into for a character: consumesInto lists targets,
// consumesIntoUnless blocks one if the character holds a blocking slug,
// consumesIntoDurations overrides a grant's expiry, consumesIntoOneOf picks
// between alternatives at one position, consumesIntoResources grants flat ⬢.
//
// One more rule sits on top of those: the LADDER (Tag.escalatesInto,
// docs/systemdocs/BREWING.md). A non-stackable tag the character already
// holds is normally left completely alone, which is why a second beer used to
// do nothing whatsoever. If the held tag names a rung above it, the grant
// climbs instead: the held rung is cleared and the one above is granted.
// tipsy -> wasted -> unconscious.
//
// Deliberately pure (no Prisma) so previews match real grants. A caller
// needing a stable preview must read consumesIntoOneOf directly, not call
// this twice — a second call can roll a different outcome.

// `heldSlugs` may be a Set or any iterable of slugs. `ladder` is an optional
// Map (or plain object) of slug -> escalatesInto, which the caller builds from
// the catalog; without one, no grant escalates and the old behaviour stands.
//
// Returns the granted slugs (oneOf entries already resolved to one pick), the
// ones a condition blocked, the rungs to CLEAR off the sheet first, the expiry
// overrides that apply to the granted ones (a plain { slug: turns } map
// carrying only slugs that survived the filter), and the flat Resources
// amount to credit.
export function resolveConsumeGrants(tag, heldSlugs, ladder = null) {
  const held = heldSlugs instanceof Set ? heldSlugs : new Set(heldSlugs ?? []);
  const conditions = tag?.consumesIntoUnless ?? null;
  const overrides = tag?.consumesIntoDurations ?? null;
  const oneOfList = tag?.consumesIntoOneOf ?? null;
  const nextRung = (slug) => (ladder instanceof Map ? ladder.get(slug) : ladder?.[slug]) ?? null;

  const slugs = [];
  const blocked = [];
  const removes = [];
  const durations = {};
  // Tracks what the sheet looks like as we go, so two of the same drink in one
  // consumesInto list climb two rungs rather than both landing on the first.
  const willHold = new Set(held);
  const consumesInto = tag?.consumesInto ?? [];
  for (let i = 0; i < consumesInto.length; i += 1) {
    const alternatives = oneOfList?.[i] ?? null;
    const picked = Array.isArray(alternatives)
      ? alternatives[Math.floor(Math.random() * alternatives.length)]
      : consumesInto[i];

    // The condition is answered against what was PICKED, before the ladder
    // moves it: `unlessTags` is how a drink says "not for someone already in
    // this state", and letting the climb dodge that would invert it.
    const blockers = conditions?.[picked] ?? null;
    if (blockers?.some((b) => held.has(b))) {
      blocked.push(picked);
      continue;
    }

    // Where this rung actually lands, given what they already hold.
    const climbed = climbLadder(picked, willHold, nextRung);
    // Already on the top rung: nowhere further to fall, so the drink is
    // simply wasted on them. Nothing cleared, nothing granted.
    if (!climbed) continue;
    const slug = climbed.slug;
    if (climbed.cleared) {
      removes.push(climbed.cleared);
      willHold.delete(climbed.cleared);
    }
    willHold.add(slug);

    slugs.push(slug);
    const override = overrides?.[slug];
    if (override != null) durations[slug] = override;
  }
  return { slugs, blocked, removes, durations, resources: tag?.consumesIntoResources ?? 0 };
}

// The held-slug set every call site needs, from the CharacterTag rows they
// already have in hand.
export function heldSlugsOf(characterTags) {
  return new Set((characterTags ?? []).map((ct) => ct.tag?.slug).filter(Boolean));
}

// Where a granted rung lands for somebody already part-way up the ladder,
// and which rung (if any) has to come off the sheet to put them there.
//
// The walk starts at `picked` and follows the chain to find the HIGHEST rung
// this character already occupies — not merely whether they hold the picked
// one. That distinction is the whole feature: somebody already Wasted does
// not hold Tipsy, so a naive "is the picked slug held?" test would hand them
// a fresh Tipsy instead of putting them on the floor.
//
// Returns { slug, cleared } — `cleared` is null for somebody starting sober —
// or null when they are on the TOP rung already, meaning the grant does
// nothing at all. Never clear a rung without granting its successor: that
// would make one more drink sober you up.
//
// `nextRung` is a function slug -> slug|null. The chain is proved acyclic at
// sync time (db/lib/tagShapes.js), so both loops terminate. Exported so the
// sheet's "Click to consume →" hint and the real grant cannot disagree.
export function climbLadder(picked, heldSlugs, nextRung) {
  const held = heldSlugs instanceof Set ? heldSlugs : new Set(heldSlugs ?? []);
  let occupied = null;
  for (let rung = picked; rung; rung = nextRung(rung)) {
    if (held.has(rung)) occupied = rung;
  }
  if (!occupied) return { slug: picked, cleared: null };
  const above = nextRung(occupied);
  if (!above) return null;
  return { slug: above, cleared: occupied };
}
