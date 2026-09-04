// A role's starting_tags entry, which is a tag NAME and optionally a count.
//
// docs/roles.yaml lists these as display names ("Merchant's License"), and
// Role.startingTagSlugs stores them verbatim despite what the column is
// called. Most roles want one of a thing, so a bare name still means one.
//
// The Depot rework needed a role to start with five of something — obols, so
// that a Baron begins the game with coin in his pocket and the Merchant has
// somebody to trade with on turn one. Repeating the name five times could not
// work: createCharacter resolves the list with `name: { in: [...] }`, which is
// a set lookup and collapses duplicates. Rather than add a parallel Int[] to
// the Role model and keep two arrays in step, the count rides in the string:
//
//   - Merchant's License      -> { name: "Merchant's License", quantity: 1 }
//   - Obol x5                 -> { name: "Obol", quantity: 5 }
//
// The suffix is deliberately strict — a trailing " x<digits>" and nothing
// else — so a tag whose real name ends in something x-ish is not silently
// truncated into a count.
const STARTING_TAG_COUNT = /^(.*\S)\s+x(\d+)$/;

function parseStartingTag(entry) {
  const raw = String(entry ?? "").trim();
  const m = STARTING_TAG_COUNT.exec(raw);
  if (!m) return { name: raw, quantity: 1 };
  const quantity = Number(m[2]);
  // "Thing x0" is a mistake, not a request for nothing. Fall back to one and
  // let the catalog validation speak up if the name is wrong too.
  if (!Number.isInteger(quantity) || quantity < 1) return { name: m[1], quantity: 1 };
  return { name: m[1], quantity };
}

// Just the names, for the several places that only care which tags a role
// touches: the sync's catalog validation, db:prune-tags' "still referenced"
// set, and the point-buy catalog's granted-tag lookup.
function startingTagNames(entries = []) {
  return entries.map((e) => parseStartingTag(e).name);
}

module.exports = { parseStartingTag, startingTagNames };
