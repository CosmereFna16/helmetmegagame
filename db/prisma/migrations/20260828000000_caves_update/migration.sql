-- CreateEnum
CREATE TYPE "CavingRollKind" AS ENUM ('TROUBLE', 'QUIET', 'FIND');

-- AlterEnum
ALTER TYPE "RequestType" ADD VALUE 'CAVING_LOOT';

-- AlterTable
ALTER TABLE "StagedEffect" ADD COLUMN     "cavingRollId" TEXT;

-- AlterTable
ALTER TABLE "StagedMessage" ADD COLUMN     "cavingRollId" TEXT;

-- AlterTable
ALTER TABLE "Tag" ADD COLUMN     "consumesIntoResources" INTEGER,
ADD COLUMN     "sellable" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "sellablePrice" INTEGER;

-- CreateTable
CREATE TABLE "CavingRoll" (
    "id" TEXT NOT NULL,
    "turnId" TEXT NOT NULL,
    "characterId" TEXT NOT NULL,
    "zoneId" TEXT NOT NULL,
    "die" INTEGER NOT NULL,
    "kind" "CavingRollKind" NOT NULL,
    "lootTier" TEXT,
    "lootTagId" TEXT,
    "lootRequestId" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "resolvedByDiscordUserId" TEXT,
    "gmNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CavingRoll_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CavingRoll_lootRequestId_key" ON "CavingRoll"("lootRequestId");

-- CreateIndex
CREATE INDEX "CavingRoll_turnId_resolvedAt_idx" ON "CavingRoll"("turnId", "resolvedAt");

-- CreateIndex
CREATE UNIQUE INDEX "CavingRoll_characterId_turnId_key" ON "CavingRoll"("characterId", "turnId");

-- AddForeignKey
ALTER TABLE "StagedMessage" ADD CONSTRAINT "StagedMessage_cavingRollId_fkey" FOREIGN KEY ("cavingRollId") REFERENCES "CavingRoll"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StagedEffect" ADD CONSTRAINT "StagedEffect_cavingRollId_fkey" FOREIGN KEY ("cavingRollId") REFERENCES "CavingRoll"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CavingRoll" ADD CONSTRAINT "CavingRoll_turnId_fkey" FOREIGN KEY ("turnId") REFERENCES "Turn"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CavingRoll" ADD CONSTRAINT "CavingRoll_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CavingRoll" ADD CONSTRAINT "CavingRoll_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "Zone"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CavingRoll" ADD CONSTRAINT "CavingRoll_lootTagId_fkey" FOREIGN KEY ("lootTagId") REFERENCES "Tag"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CavingRoll" ADD CONSTRAINT "CavingRoll_lootRequestId_fkey" FOREIGN KEY ("lootRequestId") REFERENCES "Request"("id") ON DELETE SET NULL ON UPDATE CASCADE;

