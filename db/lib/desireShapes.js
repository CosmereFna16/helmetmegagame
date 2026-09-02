// Shared shape helpers for Tag.desireLocks, so the two surfaces that could
// author it enforce one rule set — same posture as db/lib/tagShapes.js for
// expiresInto/removesInto. Today the only authoring door is docs/tags.yaml
// through db/lib/syncTags.js (the GM custom-tag form deliberately gets no
// editor for this column — see the schema comment on Tag.desireLocks), but
// the split still pays off: db/lib/desireGates.js (a later task) consumes
// the SAME normalized shape this produces.
//
// Input from YAML is `desires: { locks: [ ...clauses ] }` — an ARRAY with
// union semantics, each clause exactly one of:
//   { all: true }
//   { families: [...] }
//   { tiers: [...] }
// plus an optional `exceptFamilies: [...]`, meaningful only alongside
// `tiers` or `all` (a `families` clause already IS the family list; excepting
// from it would be self-contradictory, so that combination throws too).

const TIER_WHITELIST = new Set([1, 2, 3, 4, 5, 7]);

function isNonEmptyArray(value) {
  return Array.isArray(value) && value.length > 0;
}

// Normalizes `raw` (the YAML `desires.locks` value) into a stable JSON shape
// — a plain array of clause objects with only the keys that apply, sorted
// where order doesn't matter, so the stored Json diffs cleanly against a
// re-synced value. Null/undefined stays null: most tags lock nothing.
function normalizeDesireLocks(raw) {
  if (raw == null) return null;
  if (!Array.isArray(raw)) {
    throw new Error("desires.locks must be a list of clauses");
  }
  return raw.map((clause) => normalizeClause(clause));
}

function normalizeClause(clause) {
  const out = {};
  if (clause?.all === true) out.all = true;
  if (isNonEmptyArray(clause?.families)) out.families = [...clause.families].sort();
  if (isNonEmptyArray(clause?.tiers)) out.tiers = [...clause.tiers].sort((a, b) => a - b);
  if (isNonEmptyArray(clause?.exceptFamilies)) out.exceptFamilies = [...clause.exceptFamilies].sort();
  return out;
}

// Validates an ALREADY-NORMALIZED locks array (the output of
// normalizeDesireLocks) against the rules above. Throws, naming the tag
// slug, on the first violation — never half-applies.
//
//   locks     the normalized array, or null
//   slug      the tag being authored, for the error message
//   families  a Set of known family keys (db/lib/desireFamilies.js)
function validateDesireLocks(locks, { slug, families }) {
  if (locks == null) return;
  if (!Array.isArray(locks)) {
    throw new Error(`docs/tags.yaml: tag "${slug}" desires.locks must be a list`);
  }
  locks.forEach((clause, i) => {
    validateClause(clause, { slug, index: i, families });
  });
}

function validateClause(clause, { slug, index, families }) {
  const label = `docs/tags.yaml: tag "${slug}" desires.locks[${index}]`;
  const keys = ["all", "families", "tiers"].filter((k) => clause?.[k] != null && clause[k] !== false);
  if (keys.length !== 1) {
    throw new Error(
      `${label} must have exactly one of "all", "families", or "tiers" — found ${keys.length === 0 ? "none" : keys.join(", ")}`,
    );
  }

  // Order matters: a clause with "families" always fails the tiers/all check
  // below too (it has neither), so the families+exceptFamilies message has
  // to be checked FIRST or it can never be reached — the generic message
  // would fire instead and mask the more specific one.
  if (clause.exceptFamilies != null && "families" in clause) {
    throw new Error(`${label} has both "families" and "exceptFamilies" — a families clause is already the exact list, excepting from it makes no sense`);
  }
  if (clause.exceptFamilies != null && !("tiers" in clause) && clause.all !== true) {
    throw new Error(`${label} has exceptFamilies but no "tiers" or "all" — exceptFamilies only modifies those`);
  }

  if ("tiers" in clause) {
    for (const tier of clause.tiers) {
      if (!TIER_WHITELIST.has(tier)) {
        throw new Error(`${label} references unknown tier ${tier} — must be one of ${[...TIER_WHITELIST].join(", ")}`);
      }
    }
  }

  const familyLists = [clause.families, clause.exceptFamilies].filter(Boolean);
  for (const list of familyLists) {
    for (const key of list) {
      if (!families.has(key)) {
        throw new Error(`${label} references unknown desire family "${key}"`);
      }
    }
  }
}

module.exports = {
  normalizeDesireLocks,
  validateDesireLocks,
};
