-- AlterTable
ALTER TABLE "ArchiveEntry" ADD COLUMN     "discordChannelId" TEXT;

-- CreateIndex
CREATE INDEX "ArchiveEntry_discordChannelId_sentAt_idx" ON "ArchiveEntry"("discordChannelId", "sentAt");
