-- CreateEnum
CREATE TYPE "Weather" AS ENUM ('CLEAR', 'FOG', 'RAIN', 'STORM', 'MIGRATION');

-- AlterTable
ALTER TABLE "Character" ADD COLUMN     "turnPingOptIn" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "GameConfig" ADD COLUMN     "nextTurnNote" TEXT,
ADD COLUMN     "nextWeather" "Weather";

-- AlterTable
ALTER TABLE "Turn" ADD COLUMN     "weather" "Weather" NOT NULL DEFAULT 'CLEAR';
