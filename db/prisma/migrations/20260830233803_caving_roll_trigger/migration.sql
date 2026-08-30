-- Splits CavingRoll's dedupe by trigger, so a turn-start roll and an
-- arrival roll no longer collide as the same "already rolled" row for one
-- character in one turn. See docs/systemdocs/CAVING.md §2.

-- CreateEnum
CREATE TYPE "CavingTrigger" AS ENUM ('TURN_START', 'ARRIVAL');

-- AlterTable
ALTER TABLE "CavingRoll" ADD COLUMN "trigger" "CavingTrigger" NOT NULL DEFAULT 'TURN_START';

-- DropIndex
DROP INDEX "CavingRoll_characterId_turnId_key";

-- CreateIndex
CREATE UNIQUE INDEX "CavingRoll_characterId_turnId_trigger_key" ON "CavingRoll"("characterId", "turnId", "trigger");
