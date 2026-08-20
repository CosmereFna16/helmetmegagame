// Shared rules for character creation, imported by the wizard UI, the
// createCharacter server action, and the GM panel — so the budget a player
// is shown, the budget the server enforces, and the budget a GM sees can
// never disagree.
//
// Nothing here touches Discord or the DB; it's pure functions over rows the
// caller already loaded, which is what makes it safe to run on both sides of
// the client/server boundary.
import { roleCapacity } from "@lifeweb/db";

// Points a cursed player forfeits on their next character. Cursed is set on
// the Player (the Discord account) when a character dies, and cleared by a GM
// once the body is buried / the rites are read.
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

// A cursed player is restricted to CURSED_ROLE_SLUGS; everyone else may take
// any synced role. Threats are never synced, so they can't appear here.
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

// Signed cost: a tag that costs points reads "+2", one that grants them
// reads "-2".
export function formatCost(pointCost) {
  const cost = pointCost ?? 0;
  return cost > 0 ? `+${cost}` : String(cost);
}

// Spending is red, earning is green — the sign is about the player's wallet,
// not about the tag being good or bad. Shared with TagChip.js so a tag reads
// the same colour in the point-buy menu and on a character sheet.
export function costColor(pointCost) {
  const cost = pointCost ?? 0;
  if (cost > 0) return "var(--accent)";
  if (cost < 0) return "var(--positive)";
  return "var(--muted)";
}

export { roleCapacity };
