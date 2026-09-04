-- Two drawback ceilings at creation instead of one: a COUNT of drawback tags
-- and a TOTAL of the points they claim back, whichever binds first. A count
-- cap alone spends the same five slots on five −1s and on five −11s, which
-- made stacking the heaviest tags in the catalog the only sensible play; a
-- point cap alone is the mirror problem. See docs/systemdocs/TAGS.md §4a.

-- AlterTable
-- maxDrawbackPoints is a POSITIVE magnitude — "at most this many points may
-- be claimed back" — even though every drawback carries a negative pointCost.
ALTER TABLE "GameConfig"
ADD COLUMN     "maxDrawbackPoints" INTEGER NOT NULL DEFAULT 12;

-- The count cap goes 5 -> 6 alongside it. A Prisma @default only applies to
-- rows created after it, and production holds exactly one GameConfig row that
-- already carries 5 — so without the UPDATE below the raise would silently do
-- nothing in the live game. Guarded on the old default so a value a GM has
-- deliberately set on /gm/dev is left alone.
ALTER TABLE "GameConfig" ALTER COLUMN "maxDrawbackTags" SET DEFAULT 6;
UPDATE "GameConfig" SET "maxDrawbackTags" = 6 WHERE "maxDrawbackTags" = 5;

-- The follow-up drop the 20260831233000_drawback_tag_cap migration promised.
-- maxNegativeTags was retired when maxDrawbackTags replaced it; both services
-- have long since deployed past that build, and no code in web/, bot/ or db/
-- reads the column.
ALTER TABLE "GameConfig" DROP COLUMN "maxNegativeTags";
