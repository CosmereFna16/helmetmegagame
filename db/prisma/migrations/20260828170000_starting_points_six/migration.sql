ALTER TABLE "GameConfig" ALTER COLUMN "startingTagPoints" SET DEFAULT 6;
UPDATE "GameConfig" SET "startingTagPoints" = 6 WHERE "startingTagPoints" = 5;
