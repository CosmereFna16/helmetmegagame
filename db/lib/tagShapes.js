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

// A chain entry (expiresInto or removesInto) is either a bare slug
// ("festering") or an even random pick between several
// ({ oneOf: ["missing-leg", "missing-arm"] }). Both normalise to
// { oneOf: [...] } here — a bare slug is simply a pick of one — so
// validation, the stored Json, and the passes that apply them all handle one
// shape instead of two. Null stays null: most tags don't turn into anything.
function normalizeTagChain(field, entries, label) {
  if (entries == null) return null;
  if (!Array.isArray(entries)) {
    throw new Error(`${label}: ${field} must be a list`);
  }
  return entries.map((entry) => {
    if (typeof entry === "string") return { oneOf: [entry] };
    if (!Array.isArray(entry?.oneOf) || entry.oneOf.length === 0) {
      throw new Error(`${label}: a ${field} entry is neither a slug nor a non-empty { oneOf: [...] }`);
    }
    return { oneOf: [...entry.oneOf] };
  });
}

// The two rules every chain shares: each slug exists, and a tag may not list
// itself. The self check's failure mode differs per field, so each validator
// below names its own.
function validateChainSlugs(field, normalized, { selfSlug, knownSlugs, label, selfProblem }) {
  for (const { oneOf } of normalized ?? []) {
    for (const slug of oneOf) {
      if (!knownSlugs.has(slug)) {
        throw new Error(`${label}: tag "${selfSlug}" ${field} references unknown tag "${slug}"`);
      }
      if (slug === selfSlug) {
        throw new Error(`${label}: tag "${selfSlug}" ${field} itself — ${selfProblem}`);
      }
    }
  }
}

function normalizeExpiresInto(entries, label = "docs/tags.yaml") {
  return normalizeTagChain("expiresInto", entries, label);
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
  // The self check: the grant happens one statement before the sweep that
  // deletes the expired row, and the sweep matches on tag id — so a tag that
  // expires into itself would be re-granted and then immediately deleted,
  // doing nothing at all. Recurring conditions are written as a two-tag loop
  // instead (migraine <-> no-migraine).
  validateChainSlugs("expiresInto", normalized, {
    selfSlug,
    knownSlugs,
    label,
    selfProblem: "the sweep would delete the fresh grant. Use a two-tag loop instead.",
  });
  if (normalized && !(durationTurns > 0)) {
    throw new Error(`${label}: tag "${selfSlug}" sets expiresInto but has no durationTurns — nothing would ever fire it`);
  }
}

// removesInto — what a tag turns into when it leaves the sheet through a
// player-driven removal (the Remove Tag request, or a Heal). Same entry
// shape as expiresInto; no duration requirement, since the removal itself is
// what fires it rather than any clock. The aftermath's own
// defaultDurationTurns decides how long it lingers.
function normalizeRemovesInto(entries, label = "docs/tags.yaml") {
  return normalizeTagChain("removesInto", entries, label);
}

function validateRemovesInto(normalized, { selfSlug, knownSlugs, label = "docs/tags.yaml" }) {
  // The self check here: re-granting the tag the player just paid to remove
  // would make removal a no-op with a bill attached.
  validateChainSlugs("removesInto", normalized, {
    selfSlug,
    knownSlugs,
    label,
    selfProblem: "removing it would grant it right back.",
  });
}

// Rolls a stored (normalized) chain into concrete slugs — an even pick per
// entry, a bare slug having normalised to a one-element oneOf. The same roll
// db/lib/tagExpiryPass.js makes inline; exposed here for the removal paths.
function rollTagChain(normalized) {
  const slugs = [];
  for (const entry of Array.isArray(normalized) ? normalized : []) {
    const choices = entry?.oneOf ?? [];
    if (!choices.length) continue;
    slugs.push(choices[Math.floor(Math.random() * choices.length)]);
  }
  return slugs;
}

// requirement.items — the INGREDIENT half of a recipe, and the first one this
// game has ever actually enforced (docs/systemdocs/BREWING.md was explicit
// that nothing did). Two entry shapes, because the two recipes that use it
// want different things:
//
//     items: [skinless-brain]              a specific tag
//     items: [{ group: items-corpse }]     any tag in a group
//
// The group form is not a convenience — it is the only thing that can work for
// Miasma. A person's corpse tag is written at death (db/lib/corpseMint.js) and
// never appears in docs/tags.yaml, so no authored slug could ever name one.
// That is also why the stored column is Json rather than a Tag[] relation.
//
// HOLDING IT IS THE CHECK. Nothing here is consumed, no quantity moves, and
// crafting twice off one corpse is allowed: the recipe says you need one to
// hand, not that you use it up.
//
// `label` on each normalized entry is DENORMALIZED on purpose.
// formatTagRequirement() is pure and synchronous and is called from four
// surfaces with four different selects; resolving a group's name at render
// time would mean widening every one of them and giving the bot an extra
// query. The sync rewrites the label every run, which is the same freshness
// contract every other denormalized field in the catalog has.
function normalizeRequirementItems(entries, { tagNameBySlug = null, groupNameBySlug = null } = {}, label = "docs/tags.yaml") {
  if (entries == null) return null;
  if (!Array.isArray(entries)) throw new Error(`${label}: requirement.items must be a list`);
  if (entries.length === 0) return null;
  return entries.map((entry) => {
    if (typeof entry === "string") {
      return { kind: "tag", slug: entry, label: tagNameBySlug?.get(entry) ?? entry };
    }
    const hasTag = typeof entry?.tag === "string";
    const hasGroup = typeof entry?.group === "string";
    if (hasTag === hasGroup) {
      throw new Error(`${label}: a requirement.items entry needs exactly one of \`tag:\` or \`group:\``);
    }
    if (hasTag) {
      return { kind: "tag", slug: entry.tag, label: entry.as ?? tagNameBySlug?.get(entry.tag) ?? entry.tag };
    }
    // "Corpses" -> "a corpse". Graceless for some group names, which is what
    // the `as:` override is there for.
    const name = groupNameBySlug?.get(entry.group) ?? entry.group;
    const derived = name.replace(/s$/i, "").toLowerCase();
    return { kind: "group", slug: entry.group, label: entry.as ?? `a ${derived}` };
  });
}

function validateRequirementItems(normalized, { selfSlug, tagSlugs, groupSlugs, craftable, label = "docs/tags.yaml" }) {
  if (!normalized) return;
  const seen = new Set();
  for (const entry of normalized) {
    const known = entry.kind === "tag" ? tagSlugs : groupSlugs;
    if (!known?.has(entry.slug)) {
      throw new Error(`${label}: tag "${selfSlug}" references unknown requirement item ${entry.kind} "${entry.slug}"`);
    }
    const key = `${entry.kind}:${entry.slug}`;
    if (seen.has(key)) {
      throw new Error(`${label}: tag "${selfSlug}" lists requirement item "${entry.slug}" twice`);
    }
    seen.add(key);
  }
  // Not pedantry. The only enforcement point is the Craft path, so an `items`
  // block on anything else would sit in the catalog looking enforced and do
  // nothing — which is the exact failure mode this field exists to end.
  if (!craftable) {
    throw new Error(`${label}: tag "${selfSlug}" declares requirement.items but is not craftable — nothing would ever check it`);
  }
}

module.exports = {
  normalizeExpiresInto,
  validateExpiresInto,
  normalizeRemovesInto,
  validateRemovesInto,
  rollTagChain,
  normalizeRequirementItems,
  validateRequirementItems,
};
