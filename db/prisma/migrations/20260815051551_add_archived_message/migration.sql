-- CreateTable
CREATE TABLE "ArchivedMessage" (
    "id" TEXT NOT NULL,
    "discordMessageId" TEXT NOT NULL,
    "discordChannelId" TEXT NOT NULL,
    "characterId" TEXT,
    "characterName" TEXT NOT NULL,
    "zoneId" TEXT,
    "content" TEXT NOT NULL,
    "starCount" INTEGER NOT NULL DEFAULT 1,
    "sentAt" TIMESTAMP(3) NOT NULL,
    "archivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ArchivedMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ArchivedMessage_discordMessageId_key" ON "ArchivedMessage"("discordMessageId");

-- CreateIndex
CREATE INDEX "ArchivedMessage_zoneId_idx" ON "ArchivedMessage"("zoneId");

-- CreateIndex
CREATE INDEX "ArchivedMessage_starCount_idx" ON "ArchivedMessage"("starCount");

-- AddForeignKey
ALTER TABLE "ArchivedMessage" ADD CONSTRAINT "ArchivedMessage_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArchivedMessage" ADD CONSTRAINT "ArchivedMessage_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "Zone"("id") ON DELETE SET NULL ON UPDATE CASCADE;
