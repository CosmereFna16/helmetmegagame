-- The game transcript, written at send time rather than reconstructed at Dawn.

-- CreateEnum
CREATE TYPE "ArchiveKind" AS ENUM ('MESSAGE', 'TURN_START', 'CHARACTER_CREATED', 'DEATH', 'DESIRE_FULFILLED', 'WORST_FEAR_FULFILLED', 'LIFEWEB', 'TRAVEL');

-- AlterTable
ALTER TABLE "GameConfig" ADD COLUMN     "archiveVisible" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "archiveTravelEvents" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "ArchiveEntry" (
    "id" TEXT NOT NULL,
    "kind" "ArchiveKind" NOT NULL DEFAULT 'MESSAGE',
    "turnNumber" INTEGER,
    "turnPhase" "TurnPhase",
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "locationId" TEXT,
    "locationName" TEXT,
    "characterId" TEXT,
    "characterName" TEXT,
    "concealedAlias" TEXT,
    "content" TEXT NOT NULL,
    "discordMessageId" TEXT,
    "channelKind" TEXT,
    "threadName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ArchiveEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ArchiveEntry_discordMessageId_key" ON "ArchiveEntry"("discordMessageId");

-- CreateIndex
CREATE INDEX "ArchiveEntry_sentAt_idx" ON "ArchiveEntry"("sentAt");

-- CreateIndex
CREATE INDEX "ArchiveEntry_turnNumber_idx" ON "ArchiveEntry"("turnNumber");

-- CreateIndex
CREATE INDEX "ArchiveEntry_kind_idx" ON "ArchiveEntry"("kind");

-- CreateIndex
CREATE INDEX "ArchiveEntry_locationId_sentAt_idx" ON "ArchiveEntry"("locationId", "sentAt");

-- CreateIndex
CREATE INDEX "ArchiveEntry_characterId_sentAt_idx" ON "ArchiveEntry"("characterId", "sentAt");
