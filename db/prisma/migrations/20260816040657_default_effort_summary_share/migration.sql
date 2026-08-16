-- DropForeignKey
ALTER TABLE "DefaultEffort" DROP CONSTRAINT "DefaultEffort_zoneId_fkey";

-- AlterTable
ALTER TABLE "DefaultEffort" ADD COLUMN     "shareInSummary" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "summaryChannelId" TEXT,
ADD COLUMN     "summaryMessage" TEXT,
ALTER COLUMN "zoneId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "DefaultEffort" ADD CONSTRAINT "DefaultEffort_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "Zone"("id") ON DELETE SET NULL ON UPDATE CASCADE;
