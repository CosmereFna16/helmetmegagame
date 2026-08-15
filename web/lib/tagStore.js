import { FOLLOWER_OF_BACCHUS_SLUG } from "@lifeweb/db";

export const TAG_STORE_CATEGORIES = [
  { name: "Placeholder 1" },
  { name: "Placeholder 2" },
  { name: "Placeholder 3" },
  { name: "Bacchus", requiresTagSlug: FOLLOWER_OF_BACCHUS_SLUG },
];

export const TAG_STORE_CATEGORY_NAMES = TAG_STORE_CATEGORIES.map((c) => c.name);

export function unlockedCategoryNames(ownedSlugs) {
  return TAG_STORE_CATEGORIES.filter((c) => !c.requiresTagSlug || ownedSlugs.has(c.requiresTagSlug)).map(
    (c) => c.name
  );
}
