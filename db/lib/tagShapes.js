// Shared shape helpers for the tag columns that hold JSON rather than a
// scalar, so the two surfaces that author them enforce one rule set.
//
// There are two authoring surfaces now: docs/tags.yaml through
// db/lib/syncTags.js, and the GM tag form through
// web/app/(app)/gm/dev/tags/actions.js. These lived inline in syncTags.js
// while the YAML was the only door. Leaving them there and re-deriving the
// rules in the web action would give GMs a form that happily accepts a shape
// the next `npm run db:sync-tags` would reject — the failure would surface
// hours later, in a script, against a row nobody remembers writing.
//
// The messages take a `label` so each caller can name its own source: the
// sync says `docs/tags.yaml: tag "festering" …` and the GM form says
// something a GM reading a modal can act on.

// An expiresInto entry is either a bare slug ("festering") or an even random
// pick between several ({ oneOf: ["missing-leg", "missing-arm"] }). Both
// normalise to { oneOf: [...] } here — a bare slug is simply a pick of one —
// so validation, the stored Json, and db/lib/tagExpiryPass.js all handle one
// shape instead of two. Null stays null: most tags don't turn into anything.
function normalizeExpiresInto(entries, label = "docs/tags.yaml") {
  if (entries == null) return null;
  if (!Array.isArray(entries)) {
    throw new Error(`${label}: expiresInto must be a list`);
  }
  return entries.map((entry) => {
    if (typeof entry === "string") return { oneOf: [entry] };
    if (!Array.isArray(entry?.oneOf) || entry.oneOf.length === 0) {
      throw new Error(`${label}: an expiresInto entry is neither a slug nor a non-empty { oneOf: [...] }`);
    }
    return { oneOf: [...entry.oneOf] };
  });
}

// The three rules an expiry chain has to satisfy. Each one is a silent no-op
// rather than an error if it slips through, which is exactly why they are
// checked up front on both doors.
//
//   normalized   the output of normalizeExpiresInto, or null
//   selfSlug     the tag being authored, which may not appear in its own chain
//   knownSlugs   a Set of every slug that exists
//   durationTurns the tag's own defaultDurationTurns
function validateExpiresInto(normalized, { selfSlug, knownSlugs, durationTurns, label = "docs/tags.yaml" }) {
  for (const { oneOf } of normalized ?? []) {
    for (const slug of oneOf) {
      if (!knownSlugs.has(slug)) {
        throw new Error(`${label}: tag "${selfSlug}" expiresInto references unknown tag "${slug}"`);
      }
      // The grant happens one statement before the sweep that deletes the
      // expired row, and the sweep matches on tag id — so a tag that expires
      // into itself would be re-granted and then immediately deleted, doing
      // nothing at all. Recurring conditions are written as a two-tag loop
      // instead (migraine <-> no-migraine).
      if (slug === selfSlug) {
        throw new Error(
          `${label}: tag "${selfSlug}" expiresInto itself — the sweep would delete the fresh grant. Use a two-tag loop instead.`,
        );
      }
    }
  }
  if (normalized && !(durationTurns > 0)) {
    throw new Error(`${label}: tag "${selfSlug}" sets expiresInto but has no durationTurns — nothing would ever fire it`);
  }
}

module.exports = { normalizeExpiresInto, validateExpiresInto };
