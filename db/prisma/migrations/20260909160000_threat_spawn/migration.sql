-- The threat spawn offer (docs/systemdocs/THREATS.md).

-- CreateEnum
CREATE TYPE "ThreatSpawnStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED', 'CANCELLED');

-- CreateTable
CREATE TABLE "ThreatSpawn" (
    "id" TEXT NOT NULL,
    "discordUserId" TEXT NOT NULL,
    "threatSlug" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "locationId" TEXT,
    "status" "ThreatSpawnStatus" NOT NULL DEFAULT 'PENDING',
    "offeredBy" TEXT NOT NULL,
    "characterId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "ThreatSpawn_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ThreatSpawn_characterId_key" ON "ThreatSpawn"("characterId");

-- CreateIndex
CREATE INDEX "ThreatSpawn_discordUserId_status_idx" ON "ThreatSpawn"("discordUserId", "status");

-- CreateIndex
CREATE INDEX "ThreatSpawn_status_idx" ON "ThreatSpawn"("status");

-- One LIVE offer per player. A partial unique index, which Prisma's schema
-- language cannot express, so it exists only here -- `prisma migrate diff`
-- will propose dropping it and the answer is no. Same shape as
-- FactionApplication_pending_unique.
CREATE UNIQUE INDEX "ThreatSpawn_pending_unique" ON "ThreatSpawn"("discordUserId") WHERE "status" = 'PENDING';

-- AddForeignKey
ALTER TABLE "ThreatSpawn" ADD CONSTRAINT "ThreatSpawn_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ThreatSpawn" ADD CONSTRAINT "ThreatSpawn_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;
