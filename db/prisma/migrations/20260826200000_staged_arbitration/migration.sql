-- CreateEnum
CREATE TYPE "StagedMessageKind" AS ENUM ('PRIVATE', 'PUBLIC');

-- AlterTable
ALTER TABLE "GameConfig" ADD COLUMN     "turnSummaryChannelId" TEXT;

-- CreateTable
CREATE TABLE "StagedMessage" (
    "id" TEXT NOT NULL,
    "turnId" TEXT NOT NULL,
    "moveId" TEXT,
    "kind" "StagedMessageKind" NOT NULL,
    "content" TEXT NOT NULL,
    "zoneId" TEXT,
    "createdByDiscordUserId" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3),
    "deliveryFailures" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StagedMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StagedMessageRecipient" (
    "id" TEXT NOT NULL,
    "stagedMessageId" TEXT NOT NULL,
    "characterId" TEXT NOT NULL,

    CONSTRAINT "StagedMessageRecipient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StagedEffect" (
    "id" TEXT NOT NULL,
    "turnId" TEXT NOT NULL,
    "moveId" TEXT,
    "targetCharacterId" TEXT NOT NULL,
    "createdByDiscordUserId" TEXT NOT NULL,
    "batchId" TEXT,
    "payload" JSONB NOT NULL,
    "appliedAt" TIMESTAMP(3),
    "appliedEffect" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StagedEffect_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StagedMessage_turnId_idx" ON "StagedMessage"("turnId");

-- CreateIndex
CREATE INDEX "StagedMessage_moveId_idx" ON "StagedMessage"("moveId");

-- CreateIndex
CREATE INDEX "StagedMessageRecipient_characterId_idx" ON "StagedMessageRecipient"("characterId");

-- CreateIndex
CREATE UNIQUE INDEX "StagedMessageRecipient_stagedMessageId_characterId_key" ON "StagedMessageRecipient"("stagedMessageId", "characterId");

-- CreateIndex
CREATE INDEX "StagedEffect_turnId_idx" ON "StagedEffect"("turnId");

-- CreateIndex
CREATE INDEX "StagedEffect_moveId_idx" ON "StagedEffect"("moveId");

-- CreateIndex
CREATE INDEX "StagedEffect_targetCharacterId_idx" ON "StagedEffect"("targetCharacterId");

-- CreateIndex
CREATE INDEX "StagedEffect_batchId_idx" ON "StagedEffect"("batchId");

-- AddForeignKey
ALTER TABLE "StagedMessage" ADD CONSTRAINT "StagedMessage_turnId_fkey" FOREIGN KEY ("turnId") REFERENCES "Turn"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StagedMessage" ADD CONSTRAINT "StagedMessage_moveId_fkey" FOREIGN KEY ("moveId") REFERENCES "Action"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StagedMessage" ADD CONSTRAINT "StagedMessage_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "Zone"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StagedMessageRecipient" ADD CONSTRAINT "StagedMessageRecipient_stagedMessageId_fkey" FOREIGN KEY ("stagedMessageId") REFERENCES "StagedMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StagedMessageRecipient" ADD CONSTRAINT "StagedMessageRecipient_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StagedEffect" ADD CONSTRAINT "StagedEffect_turnId_fkey" FOREIGN KEY ("turnId") REFERENCES "Turn"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StagedEffect" ADD CONSTRAINT "StagedEffect_moveId_fkey" FOREIGN KEY ("moveId") REFERENCES "Action"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StagedEffect" ADD CONSTRAINT "StagedEffect_targetCharacterId_fkey" FOREIGN KEY ("targetCharacterId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE;

