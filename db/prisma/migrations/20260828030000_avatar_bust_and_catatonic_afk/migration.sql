-- Catatonic (AFK) upkeep pass (db/lib/catatonicPass.js). Purely additive:
-- one nullable column plus its index on Character, two config knobs on
-- GameConfig, same shape as the threadExpiry* pair already there.

-- AlterTable
ALTER TABLE "Character" ADD COLUMN "lastActivityTurn" INTEGER;

-- Backfill: every ALIVE character starts on the currently open turn, so
-- nobody is retroactively flagged the moment this ships.
UPDATE "Character"
SET "lastActivityTurn" = (SELECT "number" FROM "Turn" WHERE "status" = 'OPEN' LIMIT 1)
WHERE "status" = 'ALIVE';

-- CreateIndex
CREATE INDEX "Character_status_lastActivityTurn_idx" ON "Character"("status", "lastActivityTurn");

-- AlterTable
ALTER TABLE "GameConfig" ADD COLUMN "catatonicEnabled" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "GameConfig" ADD COLUMN "catatonicTurns" INTEGER NOT NULL DEFAULT 4;
