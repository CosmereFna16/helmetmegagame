import { FOLLOWER_OF_BACCHUS_SLUG } from "@lifeweb/db";

export const DESIRE_COOLDOWN_TURNS = 3;
export const DESIRE_COMPLETION_POINTS = 3;
export const DESIRE_COMPLETION_POINTS_BACCHUS = 5;

export function desireCompletionPoints(ownedSlugs) {
  return ownedSlugs.has(FOLLOWER_OF_BACCHUS_SLUG) ? DESIRE_COMPLETION_POINTS_BACCHUS : DESIRE_COMPLETION_POINTS;
}
