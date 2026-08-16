-- AlterEnum
ALTER TYPE "TagSource" ADD VALUE 'LEADER_GRANT';

-- CreateTable
CREATE TABLE "SiloTransaction" (
    "id" TEXT NOT NULL,
    "factionId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "actorDiscordUserId" TEXT NOT NULL,
    "actorCharacterId" TEXT,
    "actorName" TEXT NOT NULL,
    "toCharacterId" TEXT,
    "toName" TEXT,
    "turnNumber" INTEGER,
    "turnPhase" "TurnPhase",
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SiloTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SiloTransaction_factionId_idx" ON "SiloTransaction"("factionId");
