// Which tags a player may pick in each of the three tag-request menus.
// Sibling of purchasableTags() in characterCreation.js, kept separate because
// none of these menus involve a budget, the tier chain, or point costs — they
// route through the Requests system instead (docs/systemdocs/REQUESTS.md §3).

import { holdsRequirement } from "./characterCreation";

// `Tag.tradeable` is what decides whether a tag can change hands — both handing
// it over and lifting it off a body. This used to be a category test
// (`["Items", "Assets"]`), which was the honest signal back when tradeable was
// set on almost nothing. It no longer is: the catalog now answers per tag, and
// the category test was actively wrong in both directions. It let a corpse be
// stripped of its House and its Drone, and it ignored the 16 items that already
// said `tradeable: false` — the Quickened Nerve Braid is grafted into a neck.
//
// One flag covers both directions on purpose. Prying the Bishop's Mitre off the
// Bishop's corpse and being handed it are the same permission here; if they ever
// need to differ, that is a second field and a migration. See TAGS.md §5.
//
// db/lib/syncTags.js REQUIRES an explicit tradeable on every items/assets tag,
// so a new item can't quietly default to false and become unmovable.
export function isTradeable(tag) {
  return Boolean(tag?.tradeable);
}

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

// The Add Tag menu's real gate — the only place the two routes onto a tag are
// combined. Two ways in, either suffices:
//
//   - BUY it: purchasable after start, and you hold its requiredTag (the
//     combat/use gate — Ranged (Basic) to carry a Longbow).
//   - MAKE it: craftable, full stop. The recipe's skills are deliberately
//     NOT enforced here — Add Tag is the honor-system door (the help text
//     says so: spend the ⬢ and the turns yourself, a GM reviews the pushed
//     request), and it also covers taking gear the fiction already puts in
//     a character's hands (a clan armoury), which no skill check can see.
//     The picker's "To make: …" line still shows what the recipe expects.
//     A craftable's requiredTag isn't checked either — that's a combat/use
//     gate, not a workshop gate.
//
// The GROUP gate is unconditional and applies to BOTH routes — it's the
// hidden-category mechanism (Demoness, Bacchus; TAGS.md §3a) and is never
// bypassed by either one.
//
// Character creation and /store deliberately do NOT use this — they keep
// calling requirementSatisfied() in characterCreation.js, because buying a
// Longbow at creation should still require Ranged (Basic).
export function addRequirementSatisfied(tag, tagsById, heldTagIds) {
  if (!holdsRequirement(tag.group?.requiredTagId, tagsById, heldTagIds)) return false;
  if (
    tag.purchasable &&
    tag.purchasableAfterStart &&
    holdsRequirement(tag.requiredTagId, tagsById, heldTagIds)
  ) {
    return true;
  }
  return Boolean(tag.craftable);
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
    .filter((ct) => isTradeable(ct.tag))
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

// How many people (the rider included) a Fast Travel can carry, from the tags
// the rider holds. The Steam Automobile is inherently a 6-seat vehicle and
// does not need Cart — holding both still caps at 6, it does not stack
// further. A horse (or Wild Horse) alone seats 2; Cart upgrades that pair to
// 6. Holding Cart with no vehicle tag grants nothing on its own — per its own
// catalog text, it upgrades a horse, it isn't one, so this returns 0 exactly
// like the caller having no FAST_TRAVEL_SLUGS tag at all.
export function fastTravelCapacity(heldSlugs) {
  if (heldSlugs.has("steam-automobile")) return 6;
  const hasHorse = heldSlugs.has("horse") || heldSlugs.has("horse-windlander");
  if (!hasHorse) return 0;
  return heldSlugs.has("cart") ? 6 : 2;
}
