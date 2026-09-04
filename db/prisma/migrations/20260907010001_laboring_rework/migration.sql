-- The laboring rework. Three parts:
--
--   1. LocationYield - what one Location yields for one labor type, and how
--      far it has drifted from what docs/zones.yaml authored. No row for a
--      (location, kind) pair means that labor is impossible there.
--   2. Tag.laborBonus - the tools table (bows, the Plow, a Fishing Rod)
--      authored in docs/tags.yaml instead of hardcoded in laborAccess.js.
--   3. DefaultEffort is gone. Filing nothing now means you labor, so there is
--      no standing order left to save.
--
-- Destructive, and deliberately so: the game has not launched, DefaultEffort
-- holds nothing that cannot be re-created, and the feature it backed no longer
-- exists. See docs/systemdocs/LABORING.md.

-- CreateEnum
CREATE TYPE "LaborKind" AS ENUM ('HUNTING', 'FARMING', 'FISHING');

-- AlterTable
ALTER TABLE "Tag" ADD COLUMN     "laborBonus" JSONB;

-- DropForeignKey
ALTER TABLE "DefaultEffort" DROP CONSTRAINT "DefaultEffort_characterId_fkey";

-- DropForeignKey
ALTER TABLE "DefaultEffort" DROP CONSTRAINT "DefaultEffort_zoneId_fkey";

-- DropForeignKey
ALTER TABLE "DefaultEffort" DROP CONSTRAINT "DefaultEffort_setByCharacterId_fkey";

-- DropTable
DROP TABLE "DefaultEffort";

-- CreateTable
CREATE TABLE "LocationYield" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "kind" "LaborKind" NOT NULL,
    "base" DOUBLE PRECISION NOT NULL,
    "current" DOUBLE PRECISION NOT NULL,
    "eventTarget" DOUBLE PRECISION,
    "eventUntilTurn" INTEGER,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LocationYield_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LocationYield_locationId_kind_key" ON "LocationYield"("locationId", "kind");

-- AddForeignKey
ALTER TABLE "LocationYield" ADD CONSTRAINT "LocationYield_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE CASCADE ON UPDATE CASCADE;
