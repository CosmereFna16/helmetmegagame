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
// A stackable tag stays on offer once held — cooking a fifth meal is the
// whole point — while an ordinary one drops off the menu as before.
export function addableTags(tags, heldTagIds = []) {
  const held = new Set(heldTagIds);
  return tags.filter(
    (tag) => (tag.purchasable || tag.craftable) && (tag.stackable || !held.has(tag.id)),
  );
}

// Both of these carry the held count onto the tag they return, so the menus
// can cap a quantity field at what the character actually has.
export function removableTags(characterTags = []) {
  return characterTags
    .filter((ct) => ct.tag?.removable)
    .map((ct) => ({ ...ct.tag, quantity: ct.quantity ?? 1 }));
}

export function transferableTags(characterTags = []) {
  return characterTags
    .filter((ct) => ct.tag && TRANSFERABLE_CATEGORIES.includes(ct.tag.category))
    .map((ct) => ({ ...ct.tag, quantity: ct.quantity ?? 1 }));
}

// What the character can use up. Consuming always takes exactly one unit, so
// unlike Remove/Transfer the held count here is only ever shown, never a cap.
export function consumableTags(characterTags = []) {
  return characterTags
    .filter((ct) => ct.tag?.consumable)
    .map((ct) => ({ ...ct.tag, quantity: ct.quantity ?? 1 }));
}
