-- CreateEnum
CREATE TYPE "ZoneKind" AS ENUM ('SURFACE', 'CAVE_GROUP', 'CAVE_LEVEL');

-- CreateEnum
CREATE TYPE "PlayerThreadKind" AS ENUM ('PUBLIC', 'PRIVATE');

-- CreateEnum
CREATE TYPE "SystemReportKind" AS ENUM ('WIPE', 'DOCTOR', 'DAWN_WIPE', 'BULK_MOVE');

-- DropForeignKey
ALTER TABLE "Location" DROP CONSTRAINT "Location_zoneId_fkey";

-- DropForeignKey
ALTER TABLE "Character" DROP CONSTRAINT "Character_locationId_fkey";

-- DropForeignKey
ALTER TABLE "Role" DROP CONSTRAINT "Role_startingLocationId_fkey";

-- DropForeignKey
ALTER TABLE "_LocationConnections" DROP CONSTRAINT "_LocationConnections_A_fkey";

-- DropForeignKey
ALTER TABLE "_LocationConnections" DROP CONSTRAINT "_LocationConnections_B_fkey";

-- DropIndex
DROP INDEX "ArchiveEntry_locationId_sentAt_idx";

-- AlterTable
ALTER TABLE "GameConfig" ADD COLUMN     "autoReconcileEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "threadExpiryEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "threadExpiryTurns" INTEGER NOT NULL DEFAULT 5;

-- AlterTable
ALTER TABLE "Zone" DROP COLUMN "discordChannelIds",
ADD COLUMN     "createTopicHash" TEXT,
ADD COLUMN     "createTopicThreadId" TEXT,
ADD COLUMN     "description" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "discordCategoryId" TEXT,
ADD COLUMN     "discordPrivateChannelId" TEXT,
ADD COLUMN     "discordPublicChannelId" TEXT,
ADD COLUMN     "discordRoleId" TEXT,
ADD COLUMN     "discordSummaryChannelId" TEXT,
ADD COLUMN     "kind" "ZoneKind" NOT NULL DEFAULT 'SURFACE',
ADD COLUMN     "mapLabelX" DOUBLE PRECISION,
ADD COLUMN     "mapLabelY" DOUBLE PRECISION,
ADD COLUMN     "mapPolygon" JSONB,
ADD COLUMN     "parentZoneId" TEXT,
ADD COLUMN     "privateAnchorHash" TEXT,
ADD COLUMN     "privateAnchorMessageId" TEXT,
ADD COLUMN     "seatZoneId" TEXT,
ADD COLUMN     "slug" TEXT,
ADD COLUMN     "sortOrder" INTEGER NOT NULL DEFAULT 0;

-- Hand-written backfill (prisma migrate diff generated a bare NOT NULL add,
-- which fails on the pre-rework Zone rows). Slug existing zones from their
-- names — the YAML sync then upserts by slug, so "Town" -> "town" lines up
-- with docs/zones.yaml — and seat each existing zone on itself.
UPDATE "Zone" SET "slug" = lower(regexp_replace(trim("name"), '\s+', '-', 'g')) WHERE "slug" IS NULL;
UPDATE "Zone" SET "seatZoneId" = "id" WHERE "seatZoneId" IS NULL;
ALTER TABLE "Zone" ALTER COLUMN "slug" SET NOT NULL;

-- AlterTable
ALTER TABLE "Character" DROP COLUMN "locationId";

-- AlterTable
ALTER TABLE "Role" DROP COLUMN "startingLocationId",
ADD COLUMN     "startingZoneId" TEXT;

-- AlterTable
ALTER TABLE "ArchiveEntry" DROP COLUMN "locationId",
DROP COLUMN "locationName",
ADD COLUMN     "zoneId" TEXT,
ADD COLUMN     "zoneName" TEXT;

-- DropTable
DROP TABLE "Location";

-- DropTable
DROP TABLE "_LocationConnections";

-- CreateTable
CREATE TABLE "LocationTopic" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "subLocations" JSONB NOT NULL DEFAULT '[]',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "zoneId" TEXT NOT NULL,
    "discordThreadId" TEXT,
    "postHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LocationTopic_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlayerThread" (
    "id" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "kind" "PlayerThreadKind" NOT NULL,
    "name" TEXT NOT NULL,
    "zoneId" TEXT NOT NULL,
    "creatorCharacterId" TEXT,
    "creatorDiscordUserId" TEXT,
    "persistent" BOOLEAN NOT NULL DEFAULT false,
    "lastActivityTurn" INTEGER,
    "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlayerThread_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlayerThreadInvite" (
    "threadId" TEXT NOT NULL,
    "characterId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlayerThreadInvite_pkey" PRIMARY KEY ("threadId","characterId")
);

-- CreateTable
CREATE TABLE "SystemReport" (
    "id" TEXT NOT NULL,
    "kind" "SystemReportKind" NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "ok" BOOLEAN NOT NULL DEFAULT false,
    "actorDiscordUserId" TEXT,
    "summary" JSONB NOT NULL DEFAULT '{}',
    "failures" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SystemReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_ZoneConnections" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_ZoneConnections_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE UNIQUE INDEX "LocationTopic_slug_key" ON "LocationTopic"("slug");

-- CreateIndex
CREATE INDEX "LocationTopic_zoneId_idx" ON "LocationTopic"("zoneId");

-- CreateIndex
CREATE UNIQUE INDEX "PlayerThread_threadId_key" ON "PlayerThread"("threadId");

-- CreateIndex
CREATE INDEX "PlayerThread_zoneId_idx" ON "PlayerThread"("zoneId");

-- CreateIndex
CREATE INDEX "PlayerThread_lastActivityTurn_idx" ON "PlayerThread"("lastActivityTurn");

-- CreateIndex
CREATE INDEX "PlayerThreadInvite_characterId_idx" ON "PlayerThreadInvite"("characterId");

-- CreateIndex
CREATE INDEX "SystemReport_kind_createdAt_idx" ON "SystemReport"("kind", "createdAt");

-- CreateIndex
CREATE INDEX "_ZoneConnections_B_index" ON "_ZoneConnections"("B");

-- CreateIndex
CREATE UNIQUE INDEX "Zone_slug_key" ON "Zone"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Zone_discordRoleId_key" ON "Zone"("discordRoleId");

-- CreateIndex
CREATE INDEX "Zone_seatZoneId_idx" ON "Zone"("seatZoneId");

-- CreateIndex
CREATE INDEX "Zone_parentZoneId_idx" ON "Zone"("parentZoneId");

-- CreateIndex
CREATE INDEX "ArchiveEntry_zoneId_sentAt_idx" ON "ArchiveEntry"("zoneId", "sentAt");

-- AddForeignKey
ALTER TABLE "Zone" ADD CONSTRAINT "Zone_parentZoneId_fkey" FOREIGN KEY ("parentZoneId") REFERENCES "Zone"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Zone" ADD CONSTRAINT "Zone_seatZoneId_fkey" FOREIGN KEY ("seatZoneId") REFERENCES "Zone"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LocationTopic" ADD CONSTRAINT "LocationTopic_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "Zone"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlayerThread" ADD CONSTRAINT "PlayerThread_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "Zone"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Role" ADD CONSTRAINT "Role_startingZoneId_fkey" FOREIGN KEY ("startingZoneId") REFERENCES "Zone"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_ZoneConnections" ADD CONSTRAINT "_ZoneConnections_A_fkey" FOREIGN KEY ("A") REFERENCES "Zone"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_ZoneConnections" ADD CONSTRAINT "_ZoneConnections_B_fkey" FOREIGN KEY ("B") REFERENCES "Zone"("id") ON DELETE CASCADE ON UPDATE CASCADE;

