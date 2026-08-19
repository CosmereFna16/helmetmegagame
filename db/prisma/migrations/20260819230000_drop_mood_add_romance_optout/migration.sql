-- AlterTable
ALTER TABLE "Character" DROP COLUMN "moodExpiresTurn",
DROP COLUMN "moodNote",
DROP COLUMN "moodState",
ADD COLUMN     "romanceOptOut" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "GameConfig" DROP COLUMN "moodDurationTurns",
DROP COLUMN "moodMoveBonus",
DROP COLUMN "moodMovePenalty";

-- DropEnum
DROP TYPE "MoodState";
