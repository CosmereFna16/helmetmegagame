// Shared rules for character creation, imported by the wizard UI, the
// createCharacter server action, and the GM panel — so the budget a player
// is shown, the budget the server enforces, and the budget a GM sees can
// never disagree.
//
// Nothing here touches Discord or the DB; it's pure functions over rows the
// caller already loaded, which is what makes it safe to run on both sides of
// the client/server boundary.
// Imported from the standalone module rather than the @lifeweb/db barrel:
// this file is reached from client components (PointBuy, TagChip,
// CreateCharacterWizard), and the barrel pulls in the Prisma client and
// the YAML syncs (node:fs), which cannot be bundled for the browser.
import { roleCapacity } from "@lifeweb/db/lib/roleCapacity";

// Points a cursed player forfeits on their next character. Cursed is a live
// Discord role (see web/lib/discordGuild.js#isCursed), granted automatically
// when a character dies and cleared by a GM removing the role directly in
// Discord once the body is buried / the rites are read.
export const CURSED_POINT_PENALTY = 3;

// The only roles a cursed player may take: they come back as nobody in
// particular until the curse is lifted. Matched by Role.slug.
export const CURSED_ROLE_SLUGS = ["migrant", "bum"];

// budget = config base + the role's own bonus - the curse penalty.
// Clamped at 0 so a cursed player picking a role with no bonus can still
// finish the wizard (they just buy nothing) rather than starting underwater.
export function computeBudget({ startingTagPoints, role, cursed }) {
  const base = startingTagPoints ?? 0;
  const bonus = role?.extraStartingPoints ?? 0;
  const penalty = cursed ? CURSED_POINT_PENALTY : 0;
  return Math.max(0, base + bonus - penalty);
}

// Positive pointCost spends budget; negative GRANTS it (drawbacks like Frail
// and Old). Summing signed costs means both directions fall out of the same
// arithmetic, and `remaining >= 0` is the single completion rule.
export function totalCost(tags) {
  return tags.reduce((sum, tag) => sum + (tag.pointCost ?? 0), 0);
}

export function remainingPoints({ budget, selectedTags }) {
  return budget - totalCost(selectedTags);
}

// --- Tier chains (parentTag) and prerequisites (requiredTag) ---
//
// A tier chain (Fighting (Basic) -> (Trained) -> (Skilled) -> ...) is
// sequential and replacing: buying a tier is meant to replace whichever
// lower tier of the same chain you already hold/have selected, not stack
// with it. Each tag's pointCost is the incremental cost of that one hop, so
// the cost of buying straight into a tier is the sum of every hop up to it
// -- letting a player jump straight to Expert for the combined cost without
// first buying Basic/Trained/Skilled as separate purchases, which the
// point-buy UI has no way to sequence (nothing is "owned" yet mid-wizard).
//
// requiredTag is a non-replacing prerequisite (Fighting (Archer) requires
// Fighting (Basic), but coexists with whatever Fighting tier you hold).
// Since tiers replace rather than stack, holding *any* tier of a chain
// satisfies a requirement pointing at a lower tier in that same chain.

// tag -> [tag, ...ancestors] via parentTagId, closest-first.
export function chainOf(tag, tagsById) {
  const chain = [];
  let current = tag;
  const seen = new Set();
  while (current && !seen.has(current.id)) {
    chain.push(current);
    seen.add(current.id);
    current = current.parentTagId ? tagsById.get(current.parentTagId) : null;
  }
  return chain;
}

export function tagsById(tags) {
  return new Map(tags.map((tag) => [tag.id, tag]));
}

export function cumulativeCost(tag, tagsById) {
  return totalCost(chainOf(tag, tagsById));
}

// The highest-cost chain member of `tag`'s own chain that's already
// held/selected, or null if none is. "Highest-cost" rather than
// "first found" so an out-of-order id list still resolves to the actual
// tier already owned.
function heldChainMember(tag, tagsById, heldOrSelectedIds) {
  const held = new Set(heldOrSelectedIds);
  const chain = chainOf(tag, tagsById);
  let best = null;
  for (const member of chain) {
    if (member.id === tag.id) continue;
    if (!held.has(member.id)) continue;
    if (!best || cumulativeCost(member, tagsById) > cumulativeCost(best, tagsById)) {
      best = member;
    }
  }
  return best;
}

// Cost to acquire `tag` given what's already held/selected: the full
// cumulative chain cost, minus whatever's already paid for via a lower tier
// of the same chain.
export function effectiveCost(tag, tagsById, heldOrSelectedIds) {
  const held = heldChainMember(tag, tagsById, heldOrSelectedIds);
  const base = cumulativeCost(tag, tagsById);
  return held ? base - cumulativeCost(held, tagsById) : base;
}

// Other ids of the same chain present in heldOrSelectedIds, to drop when
// `tag` is newly selected (a chain replaces, it doesn't stack).
export function chainSiblingsToRemove(tag, tagsById, heldOrSelectedIds) {
  const chainIds = new Set(chainOf(tag, tagsById).map((t) => t.id));
  chainIds.delete(tag.id);
  return heldOrSelectedIds.filter((id) => chainIds.has(id));
}

// True if `requiredTagId` is null, or its id appears in the chain of
// something already held/selected (any tier of that chain qualifies).
export function holdsRequirement(requiredTagId, tagsById, heldOrSelectedIds) {
  if (!requiredTagId) return true;
  return heldOrSelectedIds.some((id) => {
    const held = tagsById.get(id);
    if (!held) return false;
    return chainOf(held, tagsById).some((member) => member.id === requiredTagId);
  });
}

// Both prerequisites a tag can carry, and the only place they're combined:
//
//   - `tag.requiredTagId` — the per-tag gate (Fighting (Archer) needs
//     Fighting (Basic)).
//   - `tag.group.requiredTagId` — the whole-group gate, which is the hidden
//     category mechanism. Every Demoness tag sits behind the Demoness tag via
//     its group rather than repeating requiredTag six times; see
//     docs/taggroups.yaml and docs/systemdocs/TAGS.md §3.
//
// Callers must select group.requiredTagId alongside requiredTagId, or a
// hidden category silently opens for everyone.
export function requirementSatisfied(tag, tagsById, heldOrSelectedIds) {
  return (
    holdsRequirement(tag.requiredTagId, tagsById, heldOrSelectedIds) &&
    holdsRequirement(tag.group?.requiredTagId, tagsById, heldOrSelectedIds)
  );
}

// The tags a character may actually see and buy: everything whose gates they
// satisfy. Menus must derive their category tabs from THIS, not from the raw
// offer — a category whose every tag is locked has to have no tab at all, not
// a tab reading "nothing available", which would advertise the secret.
//
// `keepIds` is what a selection UI passes for its current picks: selecting a
// tag doesn't satisfy that tag's own requirement, so without it a tag would
// disappear from under the cursor the moment it was ticked.
export function unlockedTags(tags, tagsById, heldOrSelectedIds, keepIds = []) {
  const keep = new Set(keepIds);
  return tags.filter(
    (tag) => keep.has(tag.id) || requirementSatisfied(tag, tagsById, heldOrSelectedIds),
  );
}

// Total cost of a set of selected tags, chain-aware: each tag's contribution
// is its own cumulative chain cost rather than its raw incremental
// pointCost, since a chain tier is meant to be bought outright, not stacked
// on top of separately-purchased lower tiers. Callers are expected to keep
// `tags` collapsed to at most one member per chain (chainSiblingsToRemove is
// how selection UIs enforce that) -- with that invariant, summing
// cumulativeCost per tag is exactly the "buy this tier outright" cost.
export function effectiveTotalCost(tags, tagsById) {
  return tags.reduce((sum, tag) => sum + cumulativeCost(tag, tagsById), 0);
}

// A cursed player is restricted to CURSED_ROLE_SLUGS; everyone else may take
// any synced role. Threats aren't data at all (docs/threats.md), so they
// can't appear here.
export function isRoleSelectable({ role, cursed }) {
  if (!cursed) return true;
  return CURSED_ROLE_SLUGS.includes(role.slug);
}

export function isRoleFull({ role, taken, playerCount }) {
  return taken >= roleCapacity(role, playerCount);
}

// Which catalog tags the point-buy menu offers. `afterStartOnly` is the one
// difference between the two menus: creation shows every purchasable tag,
// while the mid-game store shows only those still buyable once the game is
// underway (so a "Secretly an Android" can be a launch-day pick and never a
// mid-game one). Also filters out anything the role already grants — you
// shouldn't be able to pay for a tag you're about to be given.
export function purchasableTags({ tags, afterStartOnly, grantedNames = [] }) {
  const granted = new Set(grantedNames);
  return tags.filter((tag) => {
    if (!tag.purchasable) return false;
    if (afterStartOnly && !tag.purchasableAfterStart) return false;
    return !granted.has(tag.name);
  });
}

// Cheapest first, then alphabetical — so point-granting drawbacks lead each
// category and equal-cost tags stay in a stable, scannable order.
export function sortTagsForMenu(tags) {
  return [...tags].sort(
    (a, b) => (a.pointCost ?? 0) - (b.pointCost ?? 0) || a.name.localeCompare(b.name),
  );
}

// Distinct categories in menu order, derived from the tags actually on offer
// rather than the full catalog, so the tab bar never shows an empty tab.
export function menuCategories(tags) {
  return [...new Set(tags.map((tag) => tag.category))].sort((a, b) => a.localeCompare(b));
}

// Sign AND colour both describe the player's point pool, never whether the
// tag is a good or bad thing to have: a drawback grants points (Frail is
// "+3", green), an advantage spends them (Fighting (Basic) is "-3", accent).
// The two axes used to disagree — the sign was catalog-style while the
// colour was pool-style — which read as "Frail is worth -3 and that's good".
//
// Tag.pointCost itself stays signed catalog-style (Frail = -3) in the YAML,
// the DB, and every calculation, so `remaining = budget - sum(pointCost)`
// is untouched. This is display only. Shared by TagChip, PointBuy,
// TagRequestButtons and the creation wizard so a tag reads the same
// everywhere.
export function formatCost(pointCost) {
  const delta = -(pointCost ?? 0);
  return delta > 0 ? `+${delta}` : String(delta);
}

export function costColor(pointCost) {
  const cost = pointCost ?? 0;
  if (cost < 0) return "var(--positive)"; // grants points
  if (cost > 0) return "var(--accent-text)"; // spends points — the TEXT ember (see globals.css header rule 2)
  return "var(--muted)";
}

export { roleCapacity };

// The one definition of "this tag matches what I typed", shared by the
// player's point-buy menu and the GM tag editor so a search behaves the same
// on both. Pure, like everything else in this file.
//
// Matches across name, description and group name, because a GM hunting for
// "the paralysis one" is as likely to remember the wording as the title.
// Every whitespace-separated term must match somewhere (AND, not OR), so
// "cook skill" narrows rather than widens. Diacritics are folded so "neonate"
// finds "Néonate".
//
// Deliberately NOT a gate: callers must run this AFTER unlockedTags(), never
// instead of it, or a lucky search string would reveal a tag whose
// requirement isn't met — see the comment in PointBuy.js.
function fold(value) {
  return (value ?? "")
    .toString()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

export function filterTagsByQuery(tags, query) {
  const terms = fold(query).split(/\s+/).filter(Boolean);
  if (!terms.length) return tags;
  return tags.filter((tag) => {
    const haystack = `${fold(tag.name)} ${fold(tag.description)} ${fold(tag.group?.name)}`;
    return terms.every((term) => haystack.includes(term));
  });
}
