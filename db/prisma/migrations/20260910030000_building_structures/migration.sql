-- The building system: Structure + StructureWork, Tag.placement, and the two
-- request kinds (DAMAGE_STRUCTURE declared ahead of use — an enum value
-- cannot be dropped, so both ride one migration).
--
-- EDITED IN PLACE while still unshipped (2026-09-04): hp/maxHp dropped and
-- StructureStatus gained ABANDONED. Production never ran the original, so
-- `migrate deploy` is unaffected. Any OTHER dev database that applied the
-- earlier version must either be recreated, or hand-repaired: drop the two
-- columns, add the enum value, and fix the recorded checksum — the remedy
-- documented in 20260903120000_carry_bonus_additive/migration.sql.
--
-- Three drops the generator proposed were DECLINED by hand, per the standing
-- rule in CLAUDE.md: the ArchiveEntry/DirectMessage trgm indexes live only in
-- raw migration SQL (the schema cannot express them), and Action.opposed is
-- deliberately-kept legacy from the removed Opposed flag, the same posture as
-- the retired enum values. None of the three is drift this migration
-- introduced; expect the generator to re-propose them every time.

-- CreateEnum
CREATE TYPE "StructureStatus" AS ENUM ('UNDER_CONSTRUCTION', 'COMPLETE', 'DAMAGED', 'RUINED', 'ABANDONED');

-- AlterEnum
ALTER TYPE "RequestType" ADD VALUE 'BUILD_STRUCTURE';
ALTER TYPE "RequestType" ADD VALUE 'DAMAGE_STRUCTURE';

-- AlterTable
ALTER TABLE "Tag" ADD COLUMN     "placement" JSONB;

-- AlterTable (milestone C, same unshipped migration): structure-controlled
-- edges. authoredOpen is backfilled from the live isOpen rather than the
-- column default, so a born-closed gate that predates this migration (the
-- Fortress gatehouse) is not silently re-authored open.
ALTER TABLE "LocationLink" ADD COLUMN "structural" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "LocationLink" ADD COLUMN "authoredOpen" BOOLEAN NOT NULL DEFAULT true;
UPDATE "LocationLink" SET "authoredOpen" = "isOpen";

-- CreateTable
CREATE TABLE "Structure" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "typeSlug" TEXT NOT NULL,
    "typeName" TEXT NOT NULL,
    "status" "StructureStatus" NOT NULL DEFAULT 'UNDER_CONSTRUCTION',
    "turnsNeeded" INTEGER NOT NULL,
    "turnsDone" INTEGER NOT NULL DEFAULT 0,
    "resourcesCost" INTEGER NOT NULL DEFAULT 0,
    "payerKey" TEXT,
    "payerName" TEXT,
    "builderCharacterId" TEXT,
    "builderName" TEXT,
    "linkId" TEXT,
    "requestId" TEXT,
    "startedTurnId" TEXT,
    "lastUpkeepTurnId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Structure_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StructureWork" (
    "id" TEXT NOT NULL,
    "structureId" TEXT NOT NULL,
    "characterId" TEXT NOT NULL,
    "characterName" TEXT NOT NULL,
    "turnId" TEXT NOT NULL,
    "actionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StructureWork_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Structure_locationId_status_idx" ON "Structure"("locationId", "status");

-- CreateIndex
CREATE INDEX "Structure_typeSlug_idx" ON "Structure"("typeSlug");

-- CreateIndex
CREATE INDEX "StructureWork_characterId_idx" ON "StructureWork"("characterId");

-- CreateIndex
CREATE UNIQUE INDEX "StructureWork_structureId_characterId_turnId_key" ON "StructureWork"("structureId", "characterId", "turnId");

-- AddForeignKey
ALTER TABLE "Structure" ADD CONSTRAINT "Structure_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Structure" ADD CONSTRAINT "Structure_linkId_fkey" FOREIGN KEY ("linkId") REFERENCES "LocationLink"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StructureWork" ADD CONSTRAINT "StructureWork_structureId_fkey" FOREIGN KEY ("structureId") REFERENCES "Structure"("id") ON DELETE CASCADE ON UPDATE CASCADE;
