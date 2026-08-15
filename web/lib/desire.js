import { FOLLOWER_OF_BACCHUS_SLUG } from "@lifeweb/db";

export const DESIRE_COOLDOWN_TURNS = 3;
export const DESIRE_MIN_POINTS = 1;
export const DESIRE_MAX_POINTS = 4;
export const DESIRE_BACCHUS_BONUS = 1;

// Clamps the GM's arbitrated significance (1-4) and adds the Bacchus bonus
// on top, so a Follower of Bacchus can receive up to DESIRE_MAX_POINTS + 1.
export function finalDesirePoints(basePoints, ownedSlugs) {
  const clamped = Math.min(DESIRE_MAX_POINTS, Math.max(DESIRE_MIN_POINTS, basePoints));
  return clamped + (ownedSlugs.has(FOLLOWER_OF_BACCHUS_SLUG) ? DESIRE_BACCHUS_BONUS : 0);
}
