-- CreateEnum
CREATE TYPE "DmDirection" AS ENUM ('INBOUND', 'OUTBOUND');

-- AlterTable
ALTER TABLE "GameConfig" DROP COLUMN "tupperChannelIds",
DROP COLUMN "summaryChannelId",
ADD COLUMN     "movesChannelId" TEXT;

-- AlterTable
ALTER TABLE "Action" ADD COLUMN     "resultMessage" TEXT;

-- CreateTable
CREATE TABLE "DirectMessage" (
    "id" TEXT NOT NULL,
    "discordUserId" TEXT NOT NULL,
    "direction" "DmDirection" NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DirectMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DirectMessage_discordUserId_idx" ON "DirectMessage"("discordUserId");

-- CreateIndex
CREATE INDEX "DirectMessage_createdAt_idx" ON "DirectMessage"("createdAt");
