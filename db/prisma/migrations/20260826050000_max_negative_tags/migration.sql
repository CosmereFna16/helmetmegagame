-- Caps how many negative-cost tags a character may buy through the point-buy
-- menu. Defaults to 4. Only POINT_BUY drawbacks count against it, so a role's
-- free drawback and anything a GM inflicts are unaffected; see
-- docs/systemdocs/TAGS.md §4a.

-- AlterTable
ALTER TABLE "GameConfig" ADD COLUMN     "maxNegativeTags" INTEGER NOT NULL DEFAULT 4;
