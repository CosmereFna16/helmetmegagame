// Player-facing filter for the Tag Catalog tab on /documents (see
// TagCatalogTab.js). Pure — no prisma, no auth — so it can be unit-tested
// and reused by both the page (server) and, if ever needed, a client caller.
//
// Visibility is the tag's own `catalog:` flag (docs/tags.yaml, required on
// every entry -> Tag.catalogVisibility):
//   SECRET — cave/antagonist content. Nobody sees it here, GMs included;
//            /gm/dev/tags stays the unfiltered view.
//   GM     — GMs always; a player once their character RELATES to it: they
//            hold it, their role's starting kit grants it, they hold its
//            group's key tag, or — for Depot-priced wares — they hold the
//            Merchant's License.
//   ALL    — fully public, character or not.
import { holdsRequirement } from "./characterCreation";

// The Depot relation: holding the licence is what opens the counter in play
// (DEPOT.md), so it is also what opens the Depot's shelf in the catalog.
const DEPOT_KEY_SLUG = "merchants-license";

export function catalogTags(tags, { isGm, heldTagIds = [], startingTagSlugs = [] }) {
  if (isGm) return tags.filter((tag) => tag.catalogVisibility !== "SECRET");

  const tagsById = new Map(tags.map((t) => [t.id, t]));
  const held = new Set(heldTagIds);
  const starting = new Set(startingTagSlugs);
  const depotKey = tags.find((t) => t.slug === DEPOT_KEY_SLUG);
  const hasDepotAccess = Boolean(depotKey && held.has(depotKey.id));

  const relates = (tag) =>
    held.has(tag.id) ||
    starting.has(tag.slug) ||
    // The group's key tag (watchman, brigand, courtier…), at any tier of its
    // chain — the same walk the point-buy and Craft gates use. The tag's own
    // requiredTag is deliberately NOT a gate here, same as everywhere else
    // (TAGS.md §3a): Ranged (Archer) is not a secret.
    (tag.group?.requiredTagId != null &&
      holdsRequirement(tag.group.requiredTagId, tagsById, heldTagIds)) ||
    (hasDepotAccess && tag.depotPrice != null);

  return tags.filter((tag) => {
    if (tag.catalogVisibility === "ALL") return true;
    if (tag.catalogVisibility === "GM") return relates(tag);
    return false;
  });
}
