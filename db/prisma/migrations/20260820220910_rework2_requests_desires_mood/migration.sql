-- CreateEnum
CREATE TYPE "RequestType" AS ENUM ('FULFILL_DESIRE', 'ADD_TAG', 'REMOVE_TAG', 'TRANSFER_RESOURCES', 'TRANSFER_TAG', 'SET_MOOD');

-- CreateEnum
CREATE TYPE "RequestStatus" AS ENUM ('PASSED', 'EDITED', 'UNDONE');

-- CreateEnum
CREATE TYPE "DesireStatus" AS ENUM ('ACTIVE', 'FULFILLED', 'CANCELLED');

-- AlterTable
ALTER TABLE "Action" ADD COLUMN     "diceModifier" INTEGER;

-- AlterTable
ALTER TABLE "AuditLog" ADD COLUMN     "reason" TEXT;

-- CreateTable
CREATE TABLE "Request" (
    "id" TEXT NOT NULL,
    "characterId" TEXT NOT NULL,
    "turnId" TEXT,
    "type" "RequestType" NOT NULL,
    "status" "RequestStatus" NOT NULL DEFAULT 'PASSED',
    "reason" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "effect" JSONB NOT NULL,
    "gmNotes" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewedByDiscordUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Request_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Desire" (
    "id" TEXT NOT NULL,
    "characterId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "points" INTEGER NOT NULL,
    "status" "DesireStatus" NOT NULL DEFAULT 'ACTIVE',
    "setTurnNumber" INTEGER,
    "endedTurnNumber" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Desire_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Request_status_createdAt_idx" ON "Request"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Request_characterId_idx" ON "Request"("characterId");

-- CreateIndex
CREATE INDEX "Desire_characterId_status_idx" ON "Desire"("characterId", "status");

-- AddForeignKey
ALTER TABLE "Request" ADD CONSTRAINT "Request_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Request" ADD CONSTRAINT "Request_turnId_fkey" FOREIGN KEY ("turnId") REFERENCES "Turn"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Desire" ADD CONSTRAINT "Desire_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
