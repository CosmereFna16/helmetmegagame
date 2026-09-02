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

// The mount tags — what lets a character cross into a second zone in one
// turn, and how many people the mount seats. Both live in db/lib/mounts.js so
// the bot's travel flow and this page's gates read one set; re-exported here
// because the rest of this module's callers already import from it.
// See DEPOT.md §3.
export { FAST_TRAVEL_SLUGS, fastTravelCapacity } from "@lifeweb/db/lib/mounts";
