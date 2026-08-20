-- AlterTable
ALTER TABLE "Location" ADD COLUMN     "description" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "publicSubLocations" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "privateSubLocations" TEXT[] DEFAULT ARRAY[]::TEXT[];
