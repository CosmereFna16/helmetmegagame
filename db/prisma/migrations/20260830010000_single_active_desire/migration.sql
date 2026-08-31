-- Back to one ACTIVE Desire per character. Every character keeps their OLDEST
-- active Desire (the order the sheet listed them in); the rest are CANCELLED,
-- not deleted, so the row and its history survive.
--
-- endedTurnNumber is deliberately left NULL on the trimmed rows: it is what
-- drives the one-turn cooldown, and nobody should be penalised for a cap the
-- game is taking away.
WITH ranked AS (
  SELECT "id",
         ROW_NUMBER() OVER (
           PARTITION BY "characterId" ORDER BY "createdAt" ASC, "id" ASC
         ) AS rn
  FROM "Desire"
  WHERE "status" = 'ACTIVE'
)
UPDATE "Desire"
SET "status" = 'CANCELLED'
WHERE "id" IN (SELECT "id" FROM ranked WHERE rn > 1);

ALTER TABLE "GameConfig" DROP COLUMN "maxActiveDesires";
