-- Both drawback ceilings move: 6 tags / 12 points -> 4 tags / 14 points.
-- Fewer, heavier problems instead of a pile of small ones. The point cap now
-- sits ABOVE startingTagPoints on purpose, so a character carrying four real
-- problems can buy something the default budget could never reach — the old
-- "never claim back more than you started with" symmetry made the
-- heavy-drawback build a trap rather than a trade. See TAGS.md §4a.

-- A Prisma @default only applies to rows created after it, and production
-- holds exactly one GameConfig row already carrying the old values — so the
-- SET DEFAULTs alone would silently do nothing in the live game. Each UPDATE
-- is guarded on the old default so a value a GM deliberately set on /gm/dev
-- is left alone.
ALTER TABLE "GameConfig" ALTER COLUMN "maxDrawbackTags" SET DEFAULT 4;
ALTER TABLE "GameConfig" ALTER COLUMN "maxDrawbackPoints" SET DEFAULT 14;

UPDATE "GameConfig" SET "maxDrawbackTags" = 4 WHERE "maxDrawbackTags" = 6;
UPDATE "GameConfig" SET "maxDrawbackPoints" = 14 WHERE "maxDrawbackPoints" = 12;
