// Which tags a player may pick in each of the tag-request menus. Each menu
// is one catalog flag (docs/systemdocs/TAGS.md §5), re-checked server-side.

import { holdsRequirement } from "./characterCreation";

// `Tag.tradeable` covers both handing a tag over and lifting it off a body.
export function isTradeable(tag) {
  return Boolean(tag?.tradeable);
}

// Craft's recipe list: `craftable`, and every recipe skill held — the page
// hands the client the ids it already checked (docs/systemdocs/CRAFTING.md).
// A stackable tag stays on offer once held; an ordinary one drops off.
export function craftableTags(tags, heldTagIds = [], knownRecipeIds = null) {
  const held = new Set(heldTagIds);
  const known = knownRecipeIds ? new Set(knownRecipeIds) : null;
  return tags.filter(
    (tag) => tag.craftable && (!known || known.has(tag.id)) && (tag.stackable || !held.has(tag.id)),
  );
}

// The Craft menu's gate: the group's hidden-category check, plus
// `craftable`. Recipe skills are checked separately (satisfiedSkillIds), in
// the page and again in craftRequest. Character creation and /store use
// requirementSatisfied() instead, not this.
export function addRequirementSatisfied(tag, tagsById, heldTagIds) {
  if (!holdsRequirement(tag.group?.requiredTagId, tagsById, heldTagIds)) return false;
  return Boolean(tag.craftable);
}

// Destroy's list: `removable`. Carries the held count onto the returned tag,
// so the menu can cap a quantity field at what the character actually has.
export function destroyableTags(characterTags = []) {
  return characterTags
    .filter((ct) => ct.tag?.removable)
    .map((ct) => ({ ...ct.tag, quantity: ct.quantity ?? 1 }));
}

// Smithing and building need Workshop Equipment in reach; ordinary crafting
// needs nothing (docs/systemdocs/SMITHING.md). Read off the recipe's own
// skills rather than a per-tag flag, so a new sword is gated the moment it
// names a smithing skill. Pure and shared, for the reason this whole module
// is: a recipe the dialog says you can make must be one craftRequest accepts.
const WORKSHOP_SKILL_PREFIXES = ["smithing", "builder"];

//
// Workshop Equipment itself is exempt, and has to be: it is smith's work that
// names `smithing-skilled`, so gating it on a workshop would mean nobody could
// ever build the first one. You raise your first forge in the open, and it is
// what lets you do the finer work after.
export function needsWorkshop(tag) {
  if (tag?.slug === "workshop-equipment") return false;
  return (tag?.requirementSkills ?? []).some((skill) =>
    WORKSHOP_SKILL_PREFIXES.some((prefix) => skill.slug === prefix || skill.slug?.startsWith(`${prefix}-`)),
  );
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
