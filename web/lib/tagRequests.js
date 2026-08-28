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
// point-buy drawbacks and the GM/system-only statuses (Drained, Hungry,
// Tipsy, ...) stay out of reach.
// A stackable tag stays on offer once held — cooking a fifth meal is the
// whole point — while an ordinary one drops off the menu as before.
//
// `purchasableAfterStart` gates the PURCHASABLE branch only, and that
// asymmetry is the point. Without it every creation-only drawback (Frail, Fat,
// Wanted, ...) was addable mid-game, which is the leak TAGS.md §4 forbids
// outright — this is the only routed mid-game path, since PointBuy's
// afterStartOnly mode is mounted nowhere yet. Craftables skip the check
// because most of them are deliberately `purchasableAfterStart: false` (43 of
// 58: meals, tonics, explosives) — they are not bought at all, they are made,
// and their gate is the requirement block. No drawback is craftable, so
// nothing slips through the seam.
export function addableTags(tags, heldTagIds = []) {
  const held = new Set(heldTagIds);
  return tags.filter(
    (tag) =>
      ((tag.purchasable && tag.purchasableAfterStart) || tag.craftable) &&
      (tag.stackable || !held.has(tag.id)),
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

// The tags that unlock Fast Travel. Their catalog text — "Once per day, you
// may enter an adjacent zone without spending a turn, but you'll be easily
// visible" (docs/tags.yaml) — is exactly what FAST_TRAVEL implements. It lives
// here rather than in requestActions.js because that file is "use server" and
// can export nothing but async functions, and both the page's gate and the
// server action's re-derivation have to read the same set or they will drift.
//
// The Steam Automobile is the Merchant Update's addition and the only one of
// these that isn't a horse: it is imported, not bred, but it moves a person
// one zone over exactly the same way, so it rides the same request rather than
// getting a near-identical one of its own. Its description carries the same
// caveats, the caves included. See docs/systemdocs/DEPOT.md §3.
export const FAST_TRAVEL_SLUGS = new Set(["horse", "horse-windlander", "steam-automobile"]);
