// Which tags a player may pick in each of the three tag-request menus.
// Sibling of purchasableTags() in characterCreation.js, kept separate because
// none of these menus involve a budget, the tier chain, or point costs — they
// route through the Requests system instead (docs/systemdocs/REQUESTS.md §3).

// Only Items and Assets can be handed to another player. Tag.tradeable exists
// and would be the more precise filter, but it is currently set on exactly one
// tag in docs/tags.yaml, so category is the honest signal today. Revisit once
// tradeable is populated across the catalog.
export const TRANSFERABLE_CATEGORIES = ["Items", "Assets"];

// Per the brief, Add Tag offers Purchasable or Craftable tags only — the
// point-buy drawbacks and the GM/system-only statuses (Happy, Unhappy,
// Drained, ...) stay out of reach.
export function addableTags(tags, heldTagIds = []) {
  const held = new Set(heldTagIds);
  return tags.filter((tag) => (tag.purchasable || tag.craftable) && !held.has(tag.id));
}

export function removableTags(characterTags = []) {
  return characterTags.map((ct) => ct.tag).filter((tag) => tag?.removable);
}

export function transferableTags(characterTags = []) {
  return characterTags
    .map((ct) => ct.tag)
    .filter((tag) => tag && TRANSFERABLE_CATEGORIES.includes(tag.category));
}
