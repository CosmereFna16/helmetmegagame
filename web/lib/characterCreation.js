// Shared rules for character creation: the wizard UI, the createCharacter
// server action, and the GM panel all import this, so the budget a player is
// shown, the budget the server enforces, and the budget a GM sees can never
// disagree.
//
// Pure functions only — no Discord, no DB — reached from client components,
// so this stays a standalone module rather than the @lifeweb/db barrel,
// which pulls in Prisma and node:fs and can't be bundled for the browser.
import { roleCapacity } from "@lifeweb/db/lib/roleCapacity";

// Points a cursed player forfeits on their next character. Cursed is a live
// Discord role (see web/lib/discordGuild.js#isCursed), granted automatically
// when a character dies and cleared by a GM removing the role directly in
// Discord once the body is buried / the rites are read.
export const CURSED_POINT_PENALTY = 6;

// How many drawback TAGS a character may buy through the point-buy menu,
// when there is no GameConfig row to read it from. The live value is
// GameConfig.maxDrawbackTags (default 5), editable on /gm/dev.
export const DEFAULT_MAX_DRAWBACK_TAGS = 5;

// A drawback is any tag with a negative pointCost — there is no `negative`
// flag in the schema (TAGS.md §4a). This counts drawback tags held, not the
// sum of what they grant.
export function negativeTagCount(tags) {
  return tags.reduce((count, t) => ((t.pointCost ?? 0) < 0 ? count + 1 : count), 0);
}

// The only roles a cursed player may take: they come back as nobody in
// particular until the curse is lifted. Matched by Role.slug.
export const CURSED_ROLE_SLUGS = ["migrant", "bum"];

// The roster held back while GameConfig.playtestModeEnabled is on — the
// Windlands are out of scope for a short test. Matches the Zone name rather
// than a faction slug, since Role/Faction carry no availability flag.
export const PLAYTEST_LOCKED_ROLE_SLUGS = [];
export const PLAYTEST_LOCKED_ZONE_NAMES = ["Windlands"];

// Callers must have the role's zone name to hand (character/page.js walks the
// Zone -> Faction -> Role tree; createCharacter loads role.faction.zone).
// Passing no zone name only skips the zone half of the match.
export function isPlaytestLocked({ role, zoneName }) {
  return (
    PLAYTEST_LOCKED_ROLE_SLUGS.includes(role.slug) ||
    PLAYTEST_LOCKED_ZONE_NAMES.includes(zoneName ?? "")
  );
}

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
function totalCost(tags) {
  return tags.reduce((sum, tag) => sum + (tag.pointCost ?? 0), 0);
}


// --- Tier chains (parentTag) and prerequisites (requiredTag) ---
// A tier chain (Melee Basic -> Trained -> Skilled) replaces its lower tier
// rather than stacking; pointCost is per-hop, so buying straight into a
// tier sums every hop. requiredTag is a non-replacing prerequisite, and any
// tier of a chain satisfies a requirement pointing at a lower tier in it.

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

// The downward mirror of chainSiblingsToRemove: held/selected ids that sit
// ABOVE `tag` in its own chain, found by walking up from each held tag since
// chainOf() only walks upward. Non-empty means acquiring `tag` would be a
// downgrade, which every purchase path rejects.
export function heldHigherTiers(tag, tagsById, heldOrSelectedIds) {
  return heldOrSelectedIds.filter((id) => {
    if (id === tag.id) return false;
    const held = tagsById.get(id);
    if (!held) return false;
    return chainOf(held, tagsById).some((member) => member.id === tag.id);
  });
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

// Combines both prerequisites a tag can carry: `tag.requiredTagId` (the
// per-tag gate) and `tag.group.requiredTagId` (the whole-group gate behind
// a hidden category, TAGS.md §3) — callers must select both, or a hidden
// category silently opens for everyone.
export function requirementSatisfied(tag, tagsById, heldOrSelectedIds) {
  return (
    holdsRequirement(tag.requiredTagId, tagsById, heldOrSelectedIds) &&
    holdsRequirement(tag.group?.requiredTagId, tagsById, heldOrSelectedIds)
  );
}

// --- Exclusive tags (Tag.exclusive) ---
// A character may hold at most ONE tag carrying `exclusive` per group,
// except a requiredTag-linked pair (e.g. Fundamentalist/post-christian),
// checked BOTH directions. Returns the CONFLICTING TAG or null; `byId` rows
// must carry `exclusive` and `requiredTagId`, or this silently reports none.
// Not a menu gate — enforced server-side; a GM grant bypasses it (TAGS.md §3).
export function exclusiveConflict(tag, heldOrSelectedIds, byId) {
  if (!tag.exclusive) return null;
  for (const id of heldOrSelectedIds) {
    if (id === tag.id) continue;
    const other = byId.get(id);
    if (!other?.exclusive) continue;
    // Scoped to the group: one Belief, one Addiction — a Cultist's belief and
    // their addiction never collide. (Both are in a group; a groupless
    // exclusive tag conflicts only with other groupless ones.)
    if ((other.groupId ?? null) !== (tag.groupId ?? null)) continue;
    if (tag.requiredTagId === other.id || other.requiredTagId === tag.id) continue;
    return other;
  }
  return null;
}

// --- Conflicting tags (Tag.conflictsWith) ---
// A pairwise conflict edge, authored one-directional in docs/tags.yaml and
// symmetrized by db:sync-tags (SYNC.md pass 6), so a caller only checks one
// side. Unlike `exclusive`, not scoped to groupId. Returns the CONFLICTING
// TAG or null; `byId` rows must carry `conflictsWithIds` or this silently
// reports none. Enforced server-side; a GM grant bypasses it.
export function conflictingTag(tag, heldOrSelectedIds, byId) {
  const conflictIds = tag.conflictsWithIds;
  if (!conflictIds?.length) return null;
  const conflictSet = new Set(conflictIds);
  for (const id of heldOrSelectedIds) {
    if (id === tag.id) continue;
    if (conflictSet.has(id)) return byId.get(id) ?? null;
  }
  return null;
}

// The tags a character may actually see and buy. Menus must derive their
// category tabs from THIS, not the raw offer, or an all-locked category
// would advertise the secret it's hiding. `keepIds` covers a tag just
// selected, which wouldn't yet satisfy its own requirement.
export function unlockedTags(tags, tagsById, heldOrSelectedIds, keepIds = []) {
  const keep = new Set(keepIds);
  return tags.filter(
    (tag) => keep.has(tag.id) || requirementSatisfied(tag, tagsById, heldOrSelectedIds),
  );
}

// Total cost of selected tags, chain-aware: each tag's contribution is its
// own cumulative chain cost, not raw pointCost, since a tier is bought
// outright. Callers must keep `tags` collapsed to one member per chain
// (chainSiblingsToRemove enforces that). `heldIds` is what's already owned,
// so a higher tier over a held lower one charges only the difference.
export function effectiveTotalCost(tags, tagsById, heldIds = []) {
  return tags.reduce((sum, tag) => sum + effectiveCost(tag, tagsById, heldIds), 0);
}

// A cursed player is restricted to CURSED_ROLE_SLUGS; a Leader-granting role
// needs the Leader Whitelist Discord role. `playtestLocked` is the one gate
// a superadmin does NOT bypass — the others are permission gates the host
// skips to test, but this is a content lock on an unfinished role.
export function isRoleSelectable({ role, cursed, leaderWhitelisted, playtestLocked = false }) {
  if (playtestLocked) return false;
  if (role.grantsLeader && !leaderWhitelisted) return false;
  if (!cursed) return true;
  return CURSED_ROLE_SLUGS.includes(role.slug);
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

// Most expensive first, then alphabetical — so point-granting drawbacks
// trail each category and equal-cost tags stay in a stable, scannable order.
export function sortTagsForMenu(tags) {
  return [...tags].sort(
    (a, b) => (b.pointCost ?? 0) - (a.pointCost ?? 0) || a.name.localeCompare(b.name),
  );
}

// Sort key for the grouped view: chains stay adjacent (rooted at their
// cheapest tier, walked upward), everything else alphabetical. chainOf() is
// closest-first, so the root is the last entry and depth is just length.
function chainKey(tag, tagsById) {
  const chain = chainOf(tag, tagsById);
  return { root: chain[chain.length - 1].name, depth: chain.length };
}

// The three menu sorts, shared by PointBuy and the request/GM pickers so a
// chain reads in rung order everywhere. "group" is the chain-aware default;
// "cost" and "name" are deliberate flat views. A catalog fetched without
// parentTagId degrades gracefully: every chain is a singleton, so "group"
// simply reads alphabetically.
export function sortForMode(tags, mode, tagsById) {
  if (mode === "cost") return sortTagsForMenu(tags);
  if (mode === "name") return [...tags].sort((a, b) => a.name.localeCompare(b.name));
  return [...tags].sort((a, b) => {
    const ka = chainKey(a, tagsById);
    const kb = chainKey(b, tagsById);
    return ka.root.localeCompare(kb.root) || ka.depth - kb.depth || a.name.localeCompare(b.name);
  });
}

// The names behind a tag's prerequisite gates, for a "Requires: …" line —
// the per-tag requiredTag and the whole-group gate behind a hidden category.
// Callers must have fetched the requiredTag relations ({ name }) alongside
// the ids; a catalog projected without them just renders no line. Never
// shown to someone who doesn't qualify: every surface already filters unmet
// gates out before rendering.
export function prerequisiteNames(tag) {
  const names = [tag.requiredTag?.name, tag.group?.requiredTag?.name];
  return [...new Set(names.filter(Boolean))];
}

// Whether the tag has any prerequisite gate at all — the "unlocked by your
// tags" filter. A craftable's recipe skills count too (tagRequests.js
// #addRequirementSatisfied can unlock purely on requirementSkills), or a
// recipe-only tag like a brewing tonic would read as ungated.
export function hasPrerequisite(tag) {
  return Boolean(
    tag.requiredTagId || tag.group?.requiredTagId || (tag.craftable && tag.requirementSkills?.length),
  );
}

// Distinct categories in menu order, derived from the tags actually on offer
// rather than the full catalog, so the tab bar never shows an empty tab.
export function menuCategories(tags) {
  return [...new Set(tags.map((tag) => tag.category))].sort((a, b) => a.localeCompare(b));
}

// Sign AND colour both describe the player's point pool, never whether the
// tag is good or bad: a drawback grants points (Frail "+5", green), an
// advantage spends them (Melee "-7", accent). Tag.pointCost itself stays
// signed catalog-style everywhere else; this is display only, shared by
// every tag-rendering surface so a tag reads the same everywhere.
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
// point-buy menu and the GM tag editor. Matches name/description/group name;
// every whitespace-separated term must match (AND). Diacritics are folded.
// Deliberately NOT a gate — callers must run this AFTER unlockedTags(), or a
// search string could reveal a tag whose requirement isn't met.
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
