-- GameConfig.maxNegativeTags always claimed to cap the NUMBER of drawback
-- tags a character may buy at creation, but actually capped the SUM of their
-- point value (see the dropped column's schema comment history). Replaced
-- with maxDrawbackTags, a real count, default 5 (0 is a real setting: no
-- drawbacks at all). See docs/systemdocs/TAGS.md §4a.

-- AlterTable
ALTER TABLE "GameConfig" DROP COLUMN     "maxNegativeTags",
ADD COLUMN     "maxDrawbackTags" INTEGER NOT NULL DEFAULT 5;
