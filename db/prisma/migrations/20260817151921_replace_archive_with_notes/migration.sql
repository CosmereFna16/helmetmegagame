/*
  Warnings:

  - You are about to drop the `ArchivedMessage` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `MessageStar` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "ArchivedMessage" DROP CONSTRAINT "ArchivedMessage_characterId_fkey";

-- DropForeignKey
ALTER TABLE "ArchivedMessage" DROP CONSTRAINT "ArchivedMessage_zoneId_fkey";

-- DropForeignKey
ALTER TABLE "MessageStar" DROP CONSTRAINT "MessageStar_archivedMessageId_fkey";

-- DropTable
DROP TABLE "ArchivedMessage";

-- DropTable
DROP TABLE "MessageStar";

-- CreateTable
CREATE TABLE "Note" (
    "id" TEXT NOT NULL,
    "discordMessageId" TEXT NOT NULL,
    "discordChannelId" TEXT NOT NULL,
    "characterId" TEXT,
    "characterName" TEXT NOT NULL,
    "zoneId" TEXT,
    "content" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL,
    "discordUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Note_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Note_discordUserId_idx" ON "Note"("discordUserId");

-- CreateIndex
CREATE INDEX "Note_zoneId_idx" ON "Note"("zoneId");

-- CreateIndex
CREATE UNIQUE INDEX "Note_discordMessageId_discordUserId_key" ON "Note"("discordMessageId", "discordUserId");

-- AddForeignKey
ALTER TABLE "Note" ADD CONSTRAINT "Note_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Note" ADD CONSTRAINT "Note_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "Zone"("id") ON DELETE SET NULL ON UPDATE CASCADE;
