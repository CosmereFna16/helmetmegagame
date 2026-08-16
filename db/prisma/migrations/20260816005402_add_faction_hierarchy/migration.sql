-- AlterTable
ALTER TABLE "Faction" ADD COLUMN     "parentFactionId" TEXT;

-- AddForeignKey
ALTER TABLE "Faction" ADD CONSTRAINT "Faction_parentFactionId_fkey" FOREIGN KEY ("parentFactionId") REFERENCES "Faction"("id") ON DELETE SET NULL ON UPDATE CASCADE;
