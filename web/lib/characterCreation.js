// Shared rules for character creation, used by the wizard UI, the
// createCharacter server action, and the GM panel, so budgets never
// disagree.
//
// Pure functions only — no Discord, no DB — kept out of the @lifeweb/db
// barrel so this can be bundled for the browser.
import { roleCapacity } from "@lifeweb/db/lib/roleCapacity";

// Points forfeited by a cursed player's next character (see isCursed in
// web/lib/discordGuild.js).
export const CURSED_POINT_PENALTY = 6;

// Defaults for the two drawback ceilings, used only when GameConfig has no
// row yet. The live values are GameConfig.maxDrawbackTags and
// maxDrawbackPoints, both editable on /gm/dev. A build stops at whichever it
// reaches first — TAGS.md §4a has the reasoning.
export const DEFAULT_MAX_DRAWBACK_TAGS = 4;
export const DEFAULT_MAX_DRAWBACK_POINTS = 14;

// A drawback is any tag with a negative pointCost (TAGS.md §4a).
export function negativeTagCount(tags) {
  return tags.reduce((count, t) => ((t.pointCost ?? 0) < 0 ? count + 1 : count), 0);
}

// What those drawbacks claim back, as a POSITIVE magnitude — so it compares
// with maxDrawbackPoints directly and nothing has to do a sign dance.
//
// Deliberately the RAW pointCost, never effectiveCost: the tier-chain discount
// exists so upgrading Melee (Basic) to (Trained) bills only the difference,
// and no drawback is a tier of another. Running them through it would only
// give a future negative-cost chain a quiet way past the cap.
export function negativeTagPoints(tags) {
  return tags.reduce((sum, t) => ((t.pointCost ?? 0) < 0 ? sum - t.pointCost : sum), 0);
}

// The only roles a cursed player may take. Matched by Role.slug.
export const CURSED_ROLE_SLUGS = ["migrant", "bum"];

// Roster held back while GameConfig.playtestModeEnabled is on.
export const PLAYTEST_LOCKED_ROLE_SLUGS = [];
export const PLAYTEST_LOCKED_ZONE_NAMES = [];

export function isPlaytestLocked({ role, zoneName }) {
  return (
    PLAYTEST_LOCKED_ROLE_SLUGS.includes(role.slug) ||
    PLAYTEST_LOCKED_ZONE_NAMES.includes(zoneName ?? "")
  );
}

// budget = config base + role bonus - curse penalty, clamped at 0.
export function computeBudget({ startingTagPoints, role, cursed }) {
  const base = startingTagPoints ?? 0;
  const bonus = role?.extraStartingPoints ?? 0;
  const penalty = cursed ? CURSED_POINT_PENALTY : 0;
  return Math.max(0, base + bonus - penalty);
}

function totalCost(tags) {
  return tags.reduce((sum, tag) => sum + (tag.pointCost ?? 0), 0);
}

// --- Tier chains (parentTag) and prerequisites (requiredTag) ---
// A tier chain (e.g. Melee Basic -> Trained -> Skilled) replaces its lower
// tier rather than stacking. requiredTag is a non-replacing prerequisite.

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

// The highest-cost chain member already held/selected, or null.
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

// Cost to acquire `tag`, minus whatever's already paid via a lower tier.
export function effectiveCost(tag, tagsById, heldOrSelectedIds) {
  const held = heldChainMember(tag, tagsById, heldOrSelectedIds);
  const base = cumulativeCost(tag, tagsById);
  return held ? base - cumulativeCost(held, tagsById) : base;
}

// Other ids of the same chain, to drop when `tag` is newly selected.
export function chainSiblingsToRemove(tag, tagsById, heldOrSelectedIds) {
  const chainIds = new Set(chainOf(tag, tagsById).map((t) => t.id));
  chainIds.delete(tag.id);
  return heldOrSelectedIds.filter((id) => chainIds.has(id));
}

// Held/selected ids that sit ABOVE `tag` in its own chain — non-empty means
// acquiring `tag` would be a downgrade, which every purchase path rejects.
export function heldHigherTiers(tag, tagsById, heldOrSelectedIds) {
  return heldOrSelectedIds.filter((id) => {
    if (id === tag.id) return false;
    const held = tagsById.get(id);
    if (!held) return false;
    return chainOf(held, tagsById).some((member) => member.id === tag.id);
  });
}

export function holdsRequirement(requiredTagId, tagsById, heldOrSelectedIds) {
  if (!requiredTagId) return true;
  return heldOrSelectedIds.some((id) => {
    const held = tagsById.get(id);
    if (!held) return false;
    return chainOf(held, tagsById).some((member) => member.id === requiredTagId);
  });
}

// Combines both prerequisites: the per-tag requiredTag and the whole-group
// gate behind a hidden category (TAGS.md §3).
export function requirementSatisfied(tag, tagsById, heldOrSelectedIds) {
  return (
    holdsRequirement(tag.requiredTagId, tagsById, heldOrSelectedIds) &&
    holdsRequirement(tag.group?.requiredTagId, tagsById, heldOrSelectedIds)
  );
}

// --- Exclusive tags (Tag.exclusive) ---
// At most one `exclusive` tag per group, except a requiredTag-linked pair.
// Not a menu gate — enforced server-side; a GM grant bypasses it.
export function exclusiveConflict(tag, heldOrSelectedIds, byId) {
  if (!tag.exclusive) return null;
  for (const id of heldOrSelectedIds) {
    if (id === tag.id) continue;
    const other = byId.get(id);
    if (!other?.exclusive) continue;
    if ((other.groupId ?? null) !== (tag.groupId ?? null)) continue;
    if (tag.requiredTagId === other.id || other.requiredTagId === tag.id) continue;
    return other;
  }
  return null;
}

// --- Conflicting tags (Tag.conflictsWith) ---
// A pairwise conflict edge, symmetrized by db:sync-tags (SYNC.md pass 6).
// Enforced server-side; a GM grant bypasses it.
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

// --- Role-gated tags (Tag.excludedRoleSlugs / Tag.onlyRoleSlugs) ---
// A seat that can never take this tag: Devoted Follower isn't for a Migrant,
// a Mercenary or a Bum, who have nobody to be devoted to. Unlike the gates
// above this one never depends on what else is held, so it filters the menu
// outright rather than dimming a row. Enforced server-side too; a GM grant
// bypasses it.
//
// Two spellings, and a tag uses at most one of them (syncTags.js throws on
// both). `excludedRoleSlugs` names the seats shut out; `onlyRoleSlugs` names
// the only seats let in — Mime's Vow is a Minstrel's, and nobody else's.
// Both funnel through this one function so the menu, createCharacter and the
// store's buyTags cannot drift on which gate they honour.
export function roleExcluded(tag, roleSlug) {
  const only = tag.onlyRoleSlugs ?? [];
  // No seat resolved yet: an open tag stays open, a whitelisted one stays
  // shut. Guessing the other way would flash a Minstrel-only row at everybody
  // before the role picker has been touched.
  if (only.length > 0) return !roleSlug || !only.includes(roleSlug);
  if (!roleSlug) return false;
  return (tag.excludedRoleSlugs ?? []).includes(roleSlug);
}

// Tags a character may actually see and buy. Menus must derive category
// tabs from THIS, or an all-locked category advertises its own secret.
export function unlockedTags(tags, tagsById, heldOrSelectedIds, keepIds = []) {
  const keep = new Set(keepIds);
  return tags.filter(
    (tag) => keep.has(tag.id) || requirementSatisfied(tag, tagsById, heldOrSelectedIds),
  );
}

export function effectiveTotalCost(tags, tagsById, heldIds = []) {
  return tags.reduce((sum, tag) => sum + effectiveCost(tag, tagsById, heldIds), 0);
}

export function isRoleSelectable({ role, cursed, leaderWhitelisted, playtestLocked = false }) {
  if (playtestLocked) return false;
  if (role.grantsLeader && !leaderWhitelisted) return false;
  if (!cursed) return true;
  return CURSED_ROLE_SLUGS.includes(role.slug);
}

// Which catalog tags the point-buy menu offers. `afterStartOnly` distinguishes
// creation (every purchasable tag) from the mid-game store (purchasableAfterStart
// only). Also excludes anything the role already grants.
export function purchasableTags({ tags, afterStartOnly, grantedNames = [], roleSlug = null }) {
  const granted = new Set(grantedNames);
  return tags.filter((tag) => {
    if (!tag.purchasable) return false;
    if (afterStartOnly && !tag.purchasableAfterStart) return false;
    if (roleExcluded(tag, roleSlug)) return false;
    return !granted.has(tag.name);
  });
}

export function sortTagsForMenu(tags) {
  return [...tags].sort(
    (a, b) => (b.pointCost ?? 0) - (a.pointCost ?? 0) || a.name.localeCompare(b.name),
  );
}

function chainKey(tag, tagsById) {
  const chain = chainOf(tag, tagsById);
  return { root: chain[chain.length - 1].name, depth: chain.length };
}

// Shared menu sort: "group" (chain-aware, default), "cost", or "name".
export function sortForMode(tags, mode, tagsById) {
  if (mode === "cost") return sortTagsForMenu(tags);
  if (mode === "name") return [...tags].sort((a, b) => a.name.localeCompare(b.name));
  return [...tags].sort((a, b) => {
    const ka = chainKey(a, tagsById);
    const kb = chainKey(b, tagsById);
    return ka.root.localeCompare(kb.root) || ka.depth - kb.depth || a.name.localeCompare(b.name);
  });
}

// Prerequisite names for a "Requires: …" line. Callers must have fetched
// the requiredTag relations alongside the ids.
export function prerequisiteNames(tag) {
  const names = [tag.requiredTag?.name, tag.group?.requiredTag?.name];
  return [...new Set(names.filter(Boolean))];
}

export function hasPrerequisite(tag) {
  return Boolean(
    tag.requiredTagId || tag.group?.requiredTagId || (tag.craftable && tag.requirementSkills?.length),
  );
}

export function menuCategories(tags) {
  return [...new Set(tags.map((tag) => tag.category))].sort((a, b) => a.localeCompare(b));
}

// Sign and colour describe the player's point pool, not tag valence: a
// drawback grants points (green), an advantage spends them (accent).
export function formatCost(pointCost) {
  const delta = -(pointCost ?? 0);
  return delta > 0 ? `+${delta}` : String(delta);
}

export function costColor(pointCost) {
  const cost = pointCost ?? 0;
  if (cost < 0) return "var(--positive)";
  if (cost > 0) return "var(--accent-text)";
  return "var(--muted)";
}

export { roleCapacity };

// Shared "does this tag match what I typed" filter. Deliberately NOT a
// gate — callers must run this AFTER unlockedTags().
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
