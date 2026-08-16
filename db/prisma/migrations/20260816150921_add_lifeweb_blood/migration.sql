-- AlterTable
ALTER TABLE "GameConfig" ADD COLUMN     "lifewebBlood" INTEGER NOT NULL DEFAULT 100,
ADD COLUMN     "lifewebDecayPerTurn" INTEGER NOT NULL DEFAULT 10,
ADD COLUMN     "lifewebDrainedDurationTurns" INTEGER NOT NULL DEFAULT 4;
