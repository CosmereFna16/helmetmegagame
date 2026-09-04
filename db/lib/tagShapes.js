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


// The `laborBonus:` block — what a tool adds to one kind of Laboring
// (docs/systemdocs/LABORING.md). Normalised here rather than trusted straight
// from YAML because a typo in `kind` would silently make a tool worthless, and
// the symptom (a bow that pays nothing) looks like a rules question rather than
// a data bug.
//
// { kind, amount, equipped, requiresTag } or null. `equipped` defaults TRUE —
// nearly every tool is something you carry, and the two that aren't say so.
const LABOR_BONUS_KINDS = new Set(["hunting", "farming", "fishing"]);

function normalizeLaborBonus(entry, label = "docs/tags.yaml") {
  if (entry == null) return null;
  if (typeof entry !== "object" || Array.isArray(entry)) {
    throw new Error(`${label}: laborBonus must be a mapping`);
  }
  const kind = String(entry.kind ?? "").toLowerCase();
  if (!LABOR_BONUS_KINDS.has(kind)) {
    throw new Error(`${label}: laborBonus.kind must be one of ${[...LABOR_BONUS_KINDS].join(", ")}`);
  }
  const amount = Number(entry.amount);
  if (!Number.isInteger(amount) || amount === 0) {
    throw new Error(`${label}: laborBonus.amount must be a non-zero integer`);
  }
  const requiresTag = entry.requiresTag == null ? null : String(entry.requiresTag);
  return { kind, amount, equipped: entry.equipped !== false, requiresTag };
}

// Two things the shape alone can't catch: a bonus that only pays while
// equipped on a tag nothing can equip, and a requiresTag naming a tag that
// isn't in the catalog.
function validateLaborBonus(normalized, { selfSlug, tagSlugs, equippable, label = "docs/tags.yaml" }) {
  if (!normalized) return;
  if (normalized.equipped && !equippable) {
    throw new Error(
      `${label}: "${selfSlug}" has a laborBonus that requires being equipped, but the tag is not equippable`,
    );
  }
  if (normalized.requiresTag && !tagSlugs.has(normalized.requiresTag)) {
    throw new Error(`${label}: "${selfSlug}" laborBonus.requiresTag names unknown tag "${normalized.requiresTag}"`);
  }
}

// The `placement:` block — what makes a craftable BUILD ON SITE (a Structure
// row at the builder's Location) instead of landing in a pocket, from
// docs/tags.yaml (schema.prisma's Tag.placement comment has the full shape).
// Normalised here, same posture as laborBonus above: db/lib/structures.js is
// the read side and trusts this shape rather than re-deriving it.
//
// Shape checks only — no selfSlug in the messages, matching
// normalizeLaborBonus above. Cross-field rules (craftable, never
// tradeable/stackable/equippable/carryBonus, provides naming real tags) need
// the rest of the tag entry and knownSlugs, so those live in validatePlacement.
function normalizePlacement(raw, label = "docs/tags.yaml") {
  if (raw == null) return null;
  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`${label}: placement must be a mapping`);
  }
  const hp = Number(raw.hp);
  if (!Number.isInteger(hp) || hp < 1) {
    throw new Error(`${label}: placement.hp must be a positive integer`);
  }
  if (raw.unique != null && typeof raw.unique !== "boolean") {
    throw new Error(`${label}: placement.unique must be a boolean`);
  }
  if (raw.fieldwork != null && typeof raw.fieldwork !== "boolean") {
    throw new Error(`${label}: placement.fieldwork must be a boolean`);
  }
  if (raw.examine != null && (typeof raw.examine !== "string" || !raw.examine.trim())) {
    throw new Error(`${label}: placement.examine must be a non-empty string`);
  }
  if (raw.defenseNote != null && (typeof raw.defenseNote !== "string" || !raw.defenseNote.trim())) {
    throw new Error(`${label}: placement.defenseNote must be a non-empty string`);
  }
  if (raw.provides != null && (!Array.isArray(raw.provides) || raw.provides.some((s) => typeof s !== "string"))) {
    throw new Error(`${label}: placement.provides must be a list of tag slugs`);
  }
  if (raw.link != null && raw.link !== "hold_open" && raw.link !== "hold_shut") {
    throw new Error(`${label}: placement.link must be "hold_open" or "hold_shut"`);
  }
  let laborBonus = null;
  if (raw.laborBonus != null) {
    if (typeof raw.laborBonus !== "object" || Array.isArray(raw.laborBonus)) {
      throw new Error(`${label}: placement.laborBonus must be a mapping`);
    }
    const kind = String(raw.laborBonus.kind ?? "").toLowerCase();
    if (!LABOR_BONUS_KINDS.has(kind)) {
      throw new Error(`${label}: placement.laborBonus.kind must be one of ${[...LABOR_BONUS_KINDS].join(", ")}`);
    }
    const amount = Number(raw.laborBonus.amount);
    if (!Number.isInteger(amount) || amount === 0) {
      throw new Error(`${label}: placement.laborBonus.amount must be a non-zero integer`);
    }
    laborBonus = { kind, amount };
  }
  return {
    hp,
    unique: raw.unique !== false,
    fieldwork: raw.fieldwork === true,
    examine: raw.examine ?? null,
    defenseNote: raw.defenseNote ?? null,
    laborBonus,
    provides: raw.provides ?? [],
    link: raw.link ?? null,
  };
}

// Two things the shape alone can't catch: a placement block on a tag nothing
// would ever build (the Craft path is the only enforcement point, same
// reasoning as validateRequirementItems), and a placement block on a tag that
// could otherwise leave a Location — tradeable, stackable, equippable and
// carryBonus all mean "this can end up on somebody's person", which a
// Structure never does. `tag` is the raw YAML entry, so those flags are read
// as authored rather than re-derived.
function validatePlacement(placement, { slug, tag, knownSlugs, label = "docs/tags.yaml" }) {
  if (!placement) return;
  if (!tag?.craftable) {
    throw new Error(
      `${label}: tag "${slug}" declares placement but is not craftable — the build path is the only enforcement point`,
    );
  }
  if (tag.tradeable) {
    throw new Error(`${label}: tag "${slug}" declares placement but is tradeable — a structure is never on anyone's person`);
  }
  if (tag.stackable) {
    throw new Error(`${label}: tag "${slug}" declares placement but is stackable — a structure is never on anyone's person`);
  }
  if (tag.equippable) {
    throw new Error(`${label}: tag "${slug}" declares placement but is equippable — a structure is never on anyone's person`);
  }
  if (tag.carryBonus != null) {
    throw new Error(`${label}: tag "${slug}" declares placement but carries a carryBonus — a structure is never on anyone's person`);
  }
  for (const provided of placement.provides) {
    if (!knownSlugs.has(provided)) {
      throw new Error(`${label}: tag "${slug}" placement.provides references unknown tag "${provided}"`);
    }
  }
}

module.exports = {
  LABOR_BONUS_KINDS,
  normalizeLaborBonus,
  validateLaborBonus,
  normalizeExpiresInto,
  validateExpiresInto,
  normalizeRemovesInto,
  validateRemovesInto,
  rollTagChain,
  normalizeRequirementItems,
  validateRequirementItems,
  normalizePlacement,
  validatePlacement,
};
