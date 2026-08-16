-- AlterTable
ALTER TABLE "CharacterTag" ADD COLUMN     "expiresTurn" INTEGER;

-- AlterTable
ALTER TABLE "GameConfig" ADD COLUMN     "alcoholCost" INTEGER NOT NULL DEFAULT 3,
ADD COLUMN     "alcoholShieldDurationTurns" INTEGER NOT NULL DEFAULT 4;
