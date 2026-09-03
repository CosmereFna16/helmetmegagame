-- The load at the last settle, so the overflow drop can tell an ACQUISITION
-- from a capacity SHRINK. Only a load that grew past the ceiling sheds;
-- unequipping a cart at an inn door must never empty it onto the floor.
-- docs/systemdocs/CARRY.md §5.
ALTER TABLE "Character" ADD COLUMN "carryWeightSeen" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "Character" ADD COLUMN "carryResourcesSeen" INTEGER NOT NULL DEFAULT 0;

-- Seed the watermark from what people are actually carrying, so the first
-- settle after this migration does not read every existing load as brand new.
UPDATE "Character" c SET "carryResourcesSeen" = c."resources";
UPDATE "Character" c SET "carryWeightSeen" = COALESCE((
  SELECT SUM(COALESCE(t."weightLbs", 0) * ct."quantity")
  FROM "CharacterTag" ct
  JOIN "Tag" t ON t.id = ct."tagId"
  WHERE ct."characterId" = c.id AND t."tradeable" = true AND t."category" <> 'Assets'
), 0);
