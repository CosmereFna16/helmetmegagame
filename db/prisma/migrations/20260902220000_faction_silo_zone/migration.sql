-- A faction can bank somewhere other than where it is grouped. Null means
-- "same as zoneId", which is every faction but two.
-- AlterTable
ALTER TABLE "Faction" ADD COLUMN     "siloZoneId" TEXT;

-- AddForeignKey
ALTER TABLE "Faction" ADD CONSTRAINT "Faction_siloZoneId_fkey" FOREIGN KEY ("siloZoneId") REFERENCES "Zone"("id") ON DELETE SET NULL ON UPDATE CASCADE;
