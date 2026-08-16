-- AlterEnum
ALTER TYPE "ActionStatus" ADD VALUE 'PENDING_TYPE';

-- AlterTable
ALTER TABLE "Action" ALTER COLUMN "type" DROP NOT NULL;

-- AlterTable
ALTER TABLE "GameConfig" ADD COLUMN     "turnsAnnouncementChannelId" TEXT,
ADD COLUMN     "turnsAnnouncementMessageId" TEXT;
