-- AlterTable
ALTER TABLE "Location" ADD COLUMN     "slug" TEXT,
ADD COLUMN     "tags" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateIndex
CREATE UNIQUE INDEX "Location_slug_key" ON "Location"("slug");

