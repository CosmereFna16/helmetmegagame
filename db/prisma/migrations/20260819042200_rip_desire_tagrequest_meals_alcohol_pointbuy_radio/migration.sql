-- DropForeignKey
ALTER TABLE "Desire" DROP CONSTRAINT "Desire_characterId_fkey";

-- DropForeignKey
ALTER TABLE "TagChangeRequest" DROP CONSTRAINT "TagChangeRequest_characterId_fkey";

-- AlterTable
ALTER TABLE "Character" DROP COLUMN "isHungry",
DROP COLUMN "lastFineMealTurn",
DROP COLUMN "skipNextMealConsumption",
DROP COLUMN "tagPoints";

-- AlterTable
ALTER TABLE "GameConfig" DROP COLUMN "alcoholCost",
DROP COLUMN "alcoholShieldDurationTurns",
DROP COLUMN "hungerMovePenalty",
DROP COLUMN "radioChannelId",
DROP COLUMN "resourceConsumptionPerTurn",
DROP COLUMN "startingTagPoints";

-- DropTable
DROP TABLE "Desire";

-- DropTable
DROP TABLE "TagChangeRequest";

-- DropEnum
DROP TYPE "DesireStatus";

-- DropEnum
DROP TYPE "TagChangeRequestStatus";

