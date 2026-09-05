-- AlterEnum
ALTER TYPE "OfferKind" ADD VALUE 'CONFESSION';

-- AlterTable
ALTER TABLE "Tag" ADD COLUMN     "psychological" BOOLEAN NOT NULL DEFAULT false;
