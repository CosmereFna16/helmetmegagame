-- Second thoughts on 20260909140000_drawback_cap_4_14, same day: the count cap
-- lands on 5 rather than 4, and the point cap goes back to 12. That restores
-- the symmetry with startingTagPoints — you can never claim back more than you
-- started with — which is the version of the rule that says itself. See
-- TAGS.md §4a.
--
-- A separate migration rather than an edit to the 4/14 one: that migration is
-- already applied and its checksum is a row in _prisma_migrations, so editing
-- it in place would break replay.

ALTER TABLE "GameConfig" ALTER COLUMN "maxDrawbackTags" SET DEFAULT 5;
ALTER TABLE "GameConfig" ALTER COLUMN "maxDrawbackPoints" SET DEFAULT 12;

-- Guarded on the values the previous migration just wrote, so a number a GM
-- has since set by hand on /gm/dev is left alone.
UPDATE "GameConfig" SET "maxDrawbackTags" = 5 WHERE "maxDrawbackTags" = 4;
UPDATE "GameConfig" SET "maxDrawbackPoints" = 12 WHERE "maxDrawbackPoints" = 14;
