-- AlterTable
ALTER TABLE "Character" ADD COLUMN     "lastFineMealTurn" INTEGER,
ADD COLUMN     "skipNextMealConsumption" BOOLEAN NOT NULL DEFAULT false;
