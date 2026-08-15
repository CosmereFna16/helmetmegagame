-- AlterEnum
ALTER TYPE "DesireStatus" ADD VALUE 'PENDING';

-- AlterTable
ALTER TABLE "Desire" ADD COLUMN "pointsAwarded" INTEGER;
ALTER TABLE "Desire" ADD COLUMN "resultMessage" TEXT;
ALTER TABLE "Desire" ADD COLUMN "gmNotes" TEXT;
