// Which tags a player may pick in each of the three tag-request menus.
// See docs/systemdocs/REQUESTS.md §3.

import { holdsRequirement } from "./characterCreation";

// `Tag.tradeable` covers both handing a tag over and lifting it off a body.
export function isTradeable(tag) {
  return Boolean(tag?.tradeable);
}

// Add Tag is the CRAFTING door: `craftable` is the whole test. A stackable
// tag stays on offer once held; an ordinary one drops off the menu.
export function addableTags(tags, heldTagIds = []) {
  const held = new Set(heldTagIds);
  return tags.filter((tag) => tag.craftable && (tag.stackable || !held.has(tag.id)));
}

// The Add Tag menu's gate: the group's hidden-category check, plus
// `craftable`. Recipe skills are deliberately not enforced here — it's an
// honor-system door, reviewed by a GM on the pushed request. Character
// creation and /store use requirementSatisfied() instead, not this.
export function addRequirementSatisfied(tag, tagsById, heldTagIds) {
  if (!holdsRequirement(tag.group?.requiredTagId, tagsById, heldTagIds)) return false;
  return Boolean(tag.craftable);
}

// Carries the held count onto the returned tag, so the menu can cap a
// quantity field at what the character actually has.
export function removableTags(characterTags = []) {
  return characterTags
    .filter((ct) => ct.tag?.removable)
    .map((ct) => ({ ...ct.tag, quantity: ct.quantity ?? 1 }));
}

export function transferableTags(characterTags = []) {
  return characterTags
    .filter((ct) => isTradeable(ct.tag))
    .map((ct) => ({ ...ct.tag, quantity: ct.quantity ?? 1 }));
}

// Consuming always takes exactly one unit, so the held count here is shown,
// never a cap.
export function consumableTags(characterTags = []) {
  return characterTags
    .filter((ct) => ct.tag?.consumable)
    .map((ct) => ({ ...ct.tag, quantity: ct.quantity ?? 1 }));
}

// The tags that unlock Fast Travel. Lives here (not requestActions.js, which
// is "use server") so the page's gate and the server action's re-derivation
// read the same set. See DEPOT.md §3.
export const FAST_TRAVEL_SLUGS = new Set(["horse", "wild-horse", "steam-automobile"]);

// Seats a Fast Travel can carry, rider included. Steam Automobile is a fixed
// 6 and doesn't stack with Cart. A horse alone seats 2; Cart upgrades to 6.
export function fastTravelCapacity(heldSlugs) {
  if (heldSlugs.has("steam-automobile")) return 6;
  const hasHorse = heldSlugs.has("horse") || heldSlugs.has("wild-horse");
  if (!hasHorse) return 0;
  return heldSlugs.has("cart") ? 6 : 2;
}
